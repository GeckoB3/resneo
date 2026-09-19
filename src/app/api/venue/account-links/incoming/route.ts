import { NextResponse } from 'next/server';
import { resolveLinkAdmin } from '@/lib/linked-accounts/route-helpers';
import { loadLinkViewsForVenue } from '@/lib/linked-accounts/queries';
import { loadCollectiveSetupNeeds, loadInvitationsByHost } from '@/lib/linked-accounts/proposed-collectives';

const EMPTY = { incomingRequests: [], pendingChanges: [], collectiveSetup: [] };

/**
 * GET /api/venue/account-links/incoming: the lightweight feed for the dashboard banner. Pending
 * requests received by this venue (each naming the collective proposed with it, if any), pending
 * permission changes awaiting this venue's response, and, for a host, the collectives that have two
 * venues in and nothing bookable on the page yet (Docs/link-and-collective-setup-wizard-plan.md §4).
 */
export async function GET() {
  const resolved = await resolveLinkAdmin();
  if (!resolved.ok) {
    // The banner polls on every dashboard page; a non-admin or ineligible venue has nothing to show.
    return NextResponse.json(EMPTY);
  }
  const { ctx } = resolved;
  if (!ctx.eligibility.feature) {
    return NextResponse.json(EMPTY);
  }

  try {
    const [links, invitationsByHost, collectiveSetup] = await Promise.all([
      loadLinkViewsForVenue(ctx.admin, ctx.venueId),
      loadInvitationsByHost(ctx.admin, ctx.venueId),
      loadCollectiveSetupNeeds(ctx.admin, ctx.venueId),
    ]);
    const incomingRequests = links
      .filter((l) => l.status === 'pending' && !l.initiatedByMe)
      .map((l) => {
        const invitation = invitationsByHost.get(l.otherVenue.id);
        return {
          id: l.id,
          otherVenueName: l.otherVenue.name,
          createdAt: l.createdAt,
          collective: invitation ? { id: invitation.id, name: invitation.name } : null,
        };
      });
    const pendingChanges = links
      .filter((l) => l.status === 'accepted' && l.pendingChange && !l.pendingChange.proposedByMe)
      .map((l) => ({ id: l.id, otherVenueName: l.otherVenue.name }));
    return NextResponse.json(
      { incomingRequests, pendingChanges, collectiveSetup },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    console.error('GET /api/venue/account-links/incoming failed:', err);
    return NextResponse.json(EMPTY);
  }
}
