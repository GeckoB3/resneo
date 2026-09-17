import { NextResponse } from 'next/server';
import { resolveLinkAdmin } from '@/lib/linked-accounts/route-helpers';
import { hostVenueSlug, loadCollectiveCandidates } from '@/lib/linked-accounts/collective-candidates';

/**
 * GET /api/venue/collectives/candidates: every venue the host is linked with, and whether it can be
 * invited to a new collective (UX spec J1 step 2). The create route checks everything again.
 */
export async function GET() {
  const resolved = await resolveLinkAdmin();
  if (!resolved.ok) return resolved.response;
  const [candidates, hostSlug] = await Promise.all([
    loadCollectiveCandidates(resolved.ctx.admin, resolved.ctx.venueId),
    hostVenueSlug(resolved.ctx.admin, resolved.ctx.venueId),
  ]);
  return NextResponse.json({ candidates, host_slug: hostSlug }, { headers: { 'Cache-Control': 'no-store' } });
}
