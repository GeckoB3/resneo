import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveLinkAdmin, enforceLinkRateLimit } from '@/lib/linked-accounts/route-helpers';
import { requireReplicasHost } from '@/lib/linked-accounts/replicas/host-route-helpers';
import { loadHostCollectiveCalendars } from '@/lib/linked-accounts/replicas/host-calendars';
import { loadCollectiveServiceBlocks } from '@/lib/linked-accounts/replicas/service-blocks';
import { previewBulkOps } from '@/lib/linked-accounts/replicas/bulk-preview';
import { BULK_OPS_LIMIT, type BulkOp } from '@/lib/linked-accounts/replicas/bulk-ops';

const bodySchema = z.object({
  ops: z
    .array(
      z.object({
        op: z.enum(['offer', 'withdraw', 'assign', 'unassign', 'retry']),
        service_id: z.string().uuid(),
        venue_id: z.string().uuid().optional(),
        calendar_id: z.string().uuid().optional(),
      }),
    )
    .max(BULK_OPS_LIMIT * 8),
});

/**
 * POST /api/venue/collectives/[id]/bulk/preview — what each venue's guests would see if the host
 * saved the staged changes (plan Appendix E contract 13; UX spec §2 item 15 "Preview before you
 * push").
 *
 * Writes nothing: the operations are applied to a copy of what the collective looks like now. The
 * whole staged set is previewed at once, however many chunks the save itself will take, because a
 * preview of the first 200 changes would be a different page from the one the host is about to
 * make.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolved = await resolveLinkAdmin();
  if (!resolved.ok) return resolved.response;
  const { ctx } = resolved;
  const { id } = await params;

  const limited = enforceLinkRateLimit(ctx.venueId, 'collective-bulk-preview', 60, 60_000);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Send the changes to preview.' }, { status: 400 });
  }

  const host = await requireReplicasHost(ctx.admin, id, ctx.venueId);
  if (!host.ok) return host.response;

  const [groups, blocks, { data: serviceRows }] = await Promise.all([
    loadHostCollectiveCalendars(ctx.admin, ctx.venueId),
    loadCollectiveServiceBlocks(ctx.admin, ctx.venueId),
    ctx.admin.from('service_items').select('id, name').eq('venue_id', ctx.venueId).eq('is_active', true),
  ]);

  const services = (serviceRows ?? []).map((row) => ({
    id: row.id as string,
    name: (row.name as string) ?? 'A service',
    collective: blocks.get(row.id as string) ?? null,
  }));

  return NextResponse.json(
    previewBulkOps({ services, groups: groups ?? [], ops: parsed.data.ops as BulkOp[] }),
  );
}
