import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveLinkAdmin } from '@/lib/linked-accounts/route-helpers';
import { engineErrorResponse } from '@/lib/linked-accounts/replicas/host-route-helpers';
import { memberAdoptionContext } from '../adoptions/member-context';

const bodySchema = z.object({ service_id: z.string().uuid() });

/**
 * POST /api/venue/collectives/[id]/suggestions { service_id }: a member suggests one of its parked
 * services for the collective page (contract 10). The host is told once per service (N25): 201 when
 * the suggestion was made, 200 when it had been made before.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolved = await resolveLinkAdmin();
  if (!resolved.ok) return resolved.response;
  const { ctx } = resolved;
  const { id } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Choose a service to suggest.' }, { status: 400 });

  const member = await memberAdoptionContext(ctx.admin, id, ctx.venueId, ctx.userId);
  if (!member.ok) return member.response;

  const { data, error } = await ctx.admin.rpc('collective_suggest_service', {
    p_collective_id: id,
    p_service_id: parsed.data.service_id,
    p_actor_venue_id: ctx.venueId,
    p_actor_user_id: ctx.userId,
  });
  if (error) {
    return engineErrorResponse(
      error,
      { collective: member.ctx.collectiveName, host: member.ctx.hostVenueName },
      'Could not send the suggestion. Please try again.',
    );
  }
  return NextResponse.json(
    { ok: true, already_suggested: !data, host_name: member.ctx.hostVenueName },
    { status: data ? 201 : 200 },
  );
}
