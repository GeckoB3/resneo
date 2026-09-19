import { NextResponse } from 'next/server';
import { resolveLinkAdmin } from '@/lib/linked-accounts/route-helpers';
import { requireReplicasHost } from '@/lib/linked-accounts/replicas/host-route-helpers';
import { loadSameNameMatches } from '@/lib/linked-accounts/replicas/adoptions';

/**
 * GET /api/venue/collectives/[id]/same-names: for each of the host's services, the members that hold
 * a same-named service of their own, which the engine will ask about when the host puts that
 * service on the page (Docs/link-and-collective-setup-wizard-plan.md, L13). Host only.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const resolved = await resolveLinkAdmin();
  if (!resolved.ok) return resolved.response;
  const { ctx } = resolved;
  const { id } = await params;
  const host = await requireReplicasHost(ctx.admin, id, ctx.venueId);
  if (!host.ok) return host.response;
  const matches = await loadSameNameMatches(ctx.admin, id, ctx.venueId);
  return NextResponse.json({ matches }, { headers: { 'Cache-Control': 'no-store' } });
}
