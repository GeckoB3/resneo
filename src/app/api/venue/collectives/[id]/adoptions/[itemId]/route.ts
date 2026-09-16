import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveLinkAdmin } from '@/lib/linked-accounts/route-helpers';
import { loadAdoptionReview, runAnswerAdoption } from '@/lib/linked-accounts/replicas/adoptions';
import { invalidateCollectiveCatalogMemo } from '@/lib/linked-accounts/collective-venue';
import { memberAdoptionContext } from '../member-context';

/**
 * GET /api/venue/collectives/[id]/adoptions/[itemId]: one question, with both sides' options.
 * POST { choice: 'use_mine' | 'keep_separate', option_map }: the member's answer (contract 10).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  const resolved = await resolveLinkAdmin();
  if (!resolved.ok) return resolved.response;
  const { ctx } = resolved;
  const { id, itemId } = await params;
  const member = await memberAdoptionContext(ctx.admin, id, ctx.venueId, ctx.userId);
  if (!member.ok) return member.response;
  const review = z.string().uuid().safeParse(itemId).success
    ? await loadAdoptionReview(ctx.admin, id, itemId, ctx.venueId)
    : null;
  if (!review) {
    return NextResponse.json(
      { error: 'This has already been answered.', code: 'COLLECTIVE_ADOPTION_NOT_PENDING' },
      { status: 409 },
    );
  }
  return NextResponse.json(review, { headers: { 'Cache-Control': 'no-store' } });
}

const answerSchema = z.object({
  choice: z.enum(['use_mine', 'keep_separate']),
  option_map: z
    .array(z.object({ my_variant_id: z.string().uuid(), host_variant_id: z.string().uuid().nullable() }))
    .max(100)
    .optional(),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  const resolved = await resolveLinkAdmin();
  if (!resolved.ok) return resolved.response;
  const { ctx } = resolved;
  const { id, itemId } = await params;
  const parsed = answerSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !z.string().uuid().safeParse(itemId).success) {
    return NextResponse.json({ error: 'Choose whether to use your own service.' }, { status: 400 });
  }
  const member = await memberAdoptionContext(ctx.admin, id, ctx.venueId, ctx.userId);
  if (!member.ok) return member.response;
  const answered = await runAnswerAdoption(member.ctx, itemId, parsed.data);
  if (!answered.ok) return answered.response;
  invalidateCollectiveCatalogMemo(id);
  return NextResponse.json({ ok: true, collective_sync: answered.collective_sync });
}
