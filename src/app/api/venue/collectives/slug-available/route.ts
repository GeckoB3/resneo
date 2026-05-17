import { NextRequest, NextResponse } from 'next/server';
import { resolveLinkAdmin } from '@/lib/linked-accounts/route-helpers';
import { collectiveSlugSchema } from '@/lib/linked-accounts/validation';

/** GET /api/venue/collectives/slug-available?slug=... — live slug check. */
export async function GET(request: NextRequest) {
  const resolved = await resolveLinkAdmin();
  if (!resolved.ok) return resolved.response;
  const { ctx } = resolved;

  const raw = (request.nextUrl.searchParams.get('slug') ?? '').trim().toLowerCase();
  const parsed = collectiveSlugSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({
      available: false,
      reason: 'Use 3–60 lowercase letters, numbers and hyphens.',
    });
  }

  const { data } = await ctx.admin
    .from('venue_collectives')
    .select('id')
    .eq('slug', parsed.data)
    .maybeSingle();

  return NextResponse.json({
    available: !data,
    reason: data ? 'That address is already taken.' : null,
  });
}
