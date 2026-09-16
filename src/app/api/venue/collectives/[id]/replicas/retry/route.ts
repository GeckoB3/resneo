import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveLinkAdmin, enforceLinkRateLimit } from '@/lib/linked-accounts/route-helpers';
import { requireReplicasHost } from '@/lib/linked-accounts/replicas/host-route-helpers';
import { applyLinksInline } from '@/lib/linked-accounts/replicas/inline-apply';
import { invalidateCollectiveCatalogMemo } from '@/lib/linked-accounts/collective-venue';

const retrySchema = z.object({
  venue_id: z.string().uuid().optional(),
  link_ids: z.array(z.string().uuid()).max(200).optional(),
});

/**
 * POST /api/venue/collectives/[id]/replicas/retry — "Try again" on updates that are behind or
 * failing (plan Appendix E contract 2).
 *
 * With no body it retries everything that is behind; `venue_id` narrows it to one venue and
 * `link_ids` to named services. The backoff a failure set is cleared for the attempt, because a
 * person asking is a better signal than the timer. The cron keeps retrying whatever is left.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolved = await resolveLinkAdmin();
  if (!resolved.ok) return resolved.response;
  const { ctx } = resolved;
  const { id } = await params;

  const limited = enforceLinkRateLimit(ctx.venueId, 'collective-retry', 20, 60_000);
  if (limited) return limited;

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    // An empty body means "everything behind".
  }
  const parsed = retrySchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const host = await requireReplicasHost(ctx.admin, id, ctx.venueId);
  if (!host.ok) return host.response;

  let query = ctx.admin
    .from('collective_service_replicas')
    .select('id, applied_revision, desired_revision')
    .eq('collective_id', id)
    .is('released_at', null);
  if (parsed.data.venue_id) query = query.eq('venue_id', parsed.data.venue_id);
  if (parsed.data.link_ids?.length) query = query.in('id', parsed.data.link_ids);
  const { data: rows, error } = await query;
  if (error) {
    console.error('[collective] retry could not read the links:', error.message);
    return NextResponse.json({ error: 'Could not read what needs updating.' }, { status: 500 });
  }
  const behind = (rows ?? [])
    .filter((row) => Number(row.applied_revision) < Number(row.desired_revision))
    .map((row) => row.id as string);
  if (behind.length > 0) {
    // A person asked, so do not wait out the backoff a previous failure set.
    await ctx.admin
      .from('collective_service_replicas')
      .update({ next_attempt_at: null, lease_until: null })
      .in('id', behind);
  }

  const collectiveSync = await applyLinksInline(ctx.admin, behind, {
    job: 'retry',
    actorVenueId: ctx.venueId,
    actorUserId: ctx.userId,
    budgetMs: 8_000,
  });
  invalidateCollectiveCatalogMemo(id);
  return NextResponse.json({ collective_sync: collectiveSync });
}
