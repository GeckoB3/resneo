import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveLinkAdmin } from '@/lib/linked-accounts/route-helpers';
import { engineErrorResponse } from '@/lib/linked-accounts/replicas/host-route-helpers';
import { invalidateCollectiveCatalogMemo } from '@/lib/linked-accounts/collective-venue';
import { memberAdoptionContext } from '../adoptions/member-context';

const bodySchema = z.object({ accept: z.boolean() });

/**
 * POST /api/venue/collectives/[id]/address-adoption { accept }: a member's admin answers the host's
 * request to use this venue's page address for the collective page (plan §6.9, N38). Agreeing moves
 * the address; "Not now" leaves it. Either way the request is settled, and nothing else changes.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolved = await resolveLinkAdmin();
  if (!resolved.ok) return resolved.response;
  const { ctx } = resolved;
  const { id } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Choose Agree or Not now.' }, { status: 400 });

  const member = await memberAdoptionContext(ctx.admin, id, ctx.venueId, ctx.userId);
  if (!member.ok) return member.response;

  const { data, error } = await ctx.admin.rpc('collective_answer_address_adoption', {
    p_collective_id: id,
    p_venue_id: ctx.venueId,
    p_accept: parsed.data.accept,
    p_actor_user_id: ctx.userId,
  });
  if (error) {
    return engineErrorResponse(
      error,
      { collective: member.ctx.collectiveName, host: member.ctx.hostVenueName },
      'Could not save your answer. Please try again.',
    );
  }
  if (parsed.data.accept) invalidateCollectiveCatalogMemo(id);
  return NextResponse.json({ ok: true, status: (data as { status?: string } | null)?.status ?? null });
}
