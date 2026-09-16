import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveLinkAdmin, enforceLinkRateLimit } from '@/lib/linked-accounts/route-helpers';
import { requireReplicasHost } from '@/lib/linked-accounts/replicas/host-route-helpers';
import { applyLinksInline } from '@/lib/linked-accounts/replicas/inline-apply';
import { invalidateCollectiveCatalogMemo } from '@/lib/linked-accounts/collective-venue';
import { BULK_OPS_LIMIT, runBulkOps, type BulkOp } from '@/lib/linked-accounts/replicas/bulk-ops';

const opSchema = z.object({
  op: z.enum(['offer', 'withdraw', 'assign', 'unassign', 'retry']),
  service_id: z.string().uuid(),
  venue_id: z.string().uuid().optional(),
  calendar_id: z.string().uuid().optional(),
});

const bodySchema = z.object({
  ops: z.array(opSchema).min(1).max(BULK_OPS_LIMIT),
  /** The host has seen the bookings the removals would leave behind and still wants them. */
  acknowledge_affected: z.boolean().optional(),
});

/**
 * POST /api/venue/collectives/[id]/bulk — many collective changes in one save (plan Appendix E
 * contract 13; UX spec §2 item 15's bulk lane).
 *
 * Up to 200 operations, run in the order they were sent, each through the same engine function the
 * single-service routes use. The answer is one row per operation rather than one verdict for the
 * save, because a failure at one venue must not undo the twelve that worked: the grid keeps exactly
 * the failed cells staged and selected, and Retry re-sends those.
 *
 * The members' copies are applied once at the end, within the usual budget, and what the budget did
 * not reach is `pending` for the cron.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolved = await resolveLinkAdmin();
  if (!resolved.ok) return resolved.response;
  const { ctx } = resolved;
  const { id } = await params;

  const limited = enforceLinkRateLimit(ctx.venueId, 'collective-bulk', 30, 60_000);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: `Send between 1 and ${BULK_OPS_LIMIT} changes at a time.`, details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const host = await requireReplicasHost(ctx.admin, id, ctx.venueId);
  if (!host.ok) return host.response;

  const missing = parsed.data.ops.findIndex(
    (op) => (op.op === 'assign' || op.op === 'unassign') && (!op.venue_id || !op.calendar_id),
  );
  if (missing >= 0) {
    return NextResponse.json(
      { error: 'A calendar change needs both a venue and a calendar.' },
      { status: 400 },
    );
  }

  const { results, linkIds } = await runBulkOps(ctx.admin, {
    collectiveId: id,
    actorVenueId: ctx.venueId,
    actorUserId: ctx.userId,
    names: { collective: host.collective.name, host: ctx.venue.name },
    ops: parsed.data.ops as BulkOp[],
    acknowledgeAffected: parsed.data.acknowledge_affected,
  });

  const collectiveSync = await applyLinksInline(ctx.admin, linkIds, {
    job: 'bulk',
    actorVenueId: ctx.venueId,
    actorUserId: ctx.userId,
    budgetMs: 8_000,
  });
  invalidateCollectiveCatalogMemo(id);

  return NextResponse.json({ results, collective_sync: collectiveSync });
}
