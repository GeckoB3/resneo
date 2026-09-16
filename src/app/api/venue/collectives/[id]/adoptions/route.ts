import { NextResponse } from 'next/server';
import { resolveLinkAdmin } from '@/lib/linked-accounts/route-helpers';
import { loadPendingAdoptions } from '@/lib/linked-accounts/replicas/adoptions';
import { memberAdoptionContext } from './member-context';

/**
 * GET /api/venue/collectives/[id]/adoptions: the questions the host has asked this member and it
 * has not answered yet ("{host} wants to use your {service}", N26).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const resolved = await resolveLinkAdmin();
  if (!resolved.ok) return resolved.response;
  const { ctx } = resolved;
  const { id } = await params;
  const member = await memberAdoptionContext(ctx.admin, id, ctx.venueId, ctx.userId);
  if (!member.ok) return member.response;
  const adoptions = await loadPendingAdoptions(ctx.admin, id, ctx.venueId);
  return NextResponse.json(
    { host_name: member.ctx.hostVenueName, collective_name: member.ctx.collectiveName, adoptions },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
