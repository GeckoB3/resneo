import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveLinkAdmin } from '@/lib/linked-accounts/route-helpers';
import { dismissReleaseReview, loadReleaseReview } from '@/lib/linked-accounts/replicas/release-review';

/**
 * GET /api/venue/collectives/review: the "Review your services" panel after the venue left, was
 * removed from, or saw the end of a shared-services collective (plan contract 7; UX spec J7 to J9).
 * `{ review: null }` when there is nothing to review or the venue dismissed it.
 *
 * POST { collective_id }: dismiss it. A later release shows it again.
 */
export async function GET() {
  const resolved = await resolveLinkAdmin();
  if (!resolved.ok) return resolved.response;
  const review = await loadReleaseReview(resolved.ctx.admin, resolved.ctx.venueId);
  return NextResponse.json({ review }, { headers: { 'Cache-Control': 'no-store' } });
}

const dismissSchema = z.object({ collective_id: z.string().uuid() });

export async function POST(request: NextRequest) {
  const resolved = await resolveLinkAdmin();
  if (!resolved.ok) return resolved.response;
  const { ctx } = resolved;
  const parsed = dismissSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  const review = await loadReleaseReview(ctx.admin, ctx.venueId);
  if (review && review.collective_id === parsed.data.collective_id) {
    await dismissReleaseReview(ctx.admin, ctx.venueId, review.collective_id, review.released_at);
  }
  return NextResponse.json({ ok: true });
}
