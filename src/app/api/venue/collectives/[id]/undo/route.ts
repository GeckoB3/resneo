import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveLinkAdmin, enforceLinkRateLimit } from '@/lib/linked-accounts/route-helpers';
import { requireReplicasHost, engineErrorResponse } from '@/lib/linked-accounts/replicas/host-route-helpers';
import { applyLinksInline } from '@/lib/linked-accounts/replicas/inline-apply';
import { invalidateCollectiveCatalogMemo } from '@/lib/linked-accounts/collective-venue';

const undoSchema = z.object({ audit_event_id: z.string().uuid() });

/**
 * POST /api/venue/collectives/[id]/undo — put back a change to a service on the collective page,
 * within a minute of saving it (plan Appendix E contract 14, D50).
 *
 * The engine restores the before-image the save recorded and makes every member's copy due again;
 * the applies then run inline, so the members are back to the earlier version straight away. After
 * the minute the answer is 410 COLLECTIVE_UNDO_EXPIRED and the host changes it back by hand.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolved = await resolveLinkAdmin();
  if (!resolved.ok) return resolved.response;
  const { ctx } = resolved;
  const { id } = await params;

  const limited = enforceLinkRateLimit(ctx.venueId, 'collective-undo', 30, 60_000);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const parsed = undoSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'A change to undo is required.' }, { status: 400 });
  }

  const host = await requireReplicasHost(ctx.admin, id, ctx.venueId);
  if (!host.ok) return host.response;

  const { data, error } = await ctx.admin.rpc('collective_undo_master_change', {
    p_audit_event_id: parsed.data.audit_event_id,
    p_actor_venue_id: ctx.venueId,
    p_actor_user_id: ctx.userId,
  });
  if (error) {
    return engineErrorResponse(error, { collective: host.collective.name, host: ctx.venue.name }, 'Could not put that change back.');
  }

  const result = (data ?? {}) as { restored?: Record<string, unknown>; skipped?: unknown[] };
  const { data: linkRows } = await ctx.admin
    .from('collective_service_replicas')
    .select('id, applied_revision, desired_revision')
    .eq('collective_id', id)
    .is('released_at', null);
  const behind = (linkRows ?? [])
    .filter((row) => Number(row.applied_revision) < Number(row.desired_revision))
    .map((row) => row.id as string);

  const collectiveSync = await applyLinksInline(ctx.admin, behind, {
    actorVenueId: ctx.venueId,
    actorUserId: ctx.userId,
  });
  invalidateCollectiveCatalogMemo(id);

  return NextResponse.json({
    restored: result.restored ?? null,
    skipped: result.skipped ?? [],
    collective_sync: collectiveSync,
  });
}
