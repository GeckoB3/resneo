import { NextResponse } from 'next/server';
import { resolveLinkAdmin } from '@/lib/linked-accounts/route-helpers';
import { loadLinkViewsForVenue } from '@/lib/linked-accounts/queries';

/**
 * GET /api/venue/account-links/incoming — lightweight feed for the dashboard
 * banner: pending requests received by this venue, and pending permission
 * changes awaiting this venue's response.
 */
export async function GET() {
  const resolved = await resolveLinkAdmin();
  if (!resolved.ok) {
    // The banner polls on every dashboard page; a non-admin or ineligible
    // venue simply has nothing to show.
    return NextResponse.json({ incomingRequests: [], pendingChanges: [] });
  }
  const { ctx } = resolved;
  if (!ctx.eligibility.feature) {
    return NextResponse.json({ incomingRequests: [], pendingChanges: [] });
  }

  try {
    const links = await loadLinkViewsForVenue(ctx.admin, ctx.venueId);
    const incomingRequests = links
      .filter((l) => l.status === 'pending' && !l.initiatedByMe)
      .map((l) => ({ id: l.id, otherVenueName: l.otherVenue.name, createdAt: l.createdAt }));
    const pendingChanges = links
      .filter((l) => l.status === 'accepted' && l.pendingChange && !l.pendingChange.proposedByMe)
      .map((l) => ({ id: l.id, otherVenueName: l.otherVenue.name }));
    return NextResponse.json({ incomingRequests, pendingChanges });
  } catch (err) {
    console.error('GET /api/venue/account-links/incoming failed:', err);
    return NextResponse.json({ incomingRequests: [], pendingChanges: [] });
  }
}
