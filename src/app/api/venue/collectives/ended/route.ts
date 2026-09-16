import { NextResponse } from 'next/server';
import { resolveLinkAdmin } from '@/lib/linked-accounts/route-helpers';
import { loadEndedCollectivesForVenue } from '@/lib/linked-accounts/replicas/dissolved-page';

/**
 * GET /api/venue/collectives/ended: the collectives this venue was part of when they ended, while
 * their old page still shows (90 days), with whether the venue is listed there (contract 9, D25).
 */
export async function GET() {
  const resolved = await resolveLinkAdmin();
  if (!resolved.ok) return resolved.response;
  const ended = await loadEndedCollectivesForVenue(resolved.ctx.admin, resolved.ctx.venueId);
  return NextResponse.json({ ended }, { headers: { 'Cache-Control': 'no-store' } });
}
