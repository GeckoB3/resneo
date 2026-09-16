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
      format: true,
      reason: 'Use 3–60 lowercase letters, numbers and hyphens.',
    });
  }

  const { data } = await ctx.admin
    .from('venue_collectives')
    .select('id, status, host_venue_id')
    .eq('slug', parsed.data)
    .maybeSingle();
  // DL4: the host's own ended collective does not hold the address against it.
  const taken = Boolean(data) && !(data?.status === 'dissolved' && data?.host_venue_id === ctx.venueId);

  return NextResponse.json({
    available: !taken,
    reason: taken ? 'That address is already taken.' : null,
  });
}
