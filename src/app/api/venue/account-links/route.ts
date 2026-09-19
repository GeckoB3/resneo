import { NextRequest, NextResponse } from 'next/server';
import { resolveLinkAdmin } from '@/lib/linked-accounts/route-helpers';
import { createLinkSchema } from '@/lib/linked-accounts/validation';
import { countOutgoingPendingRequests, loadLinkViewsForVenue } from '@/lib/linked-accounts/queries';
import { createLinkRequest } from '@/lib/linked-accounts/link-request';
import { loadInvitationsByHost, loadInvitationsSentByHost } from '@/lib/linked-accounts/proposed-collectives';
import { MAX_PENDING_OUTGOING_REQUESTS } from '@/lib/linked-accounts/types';

/** GET /api/venue/account-links — list links for the current venue. */
export async function GET() {
  const resolved = await resolveLinkAdmin();
  if (!resolved.ok) return resolved.response;
  const { ctx } = resolved;

  if (!ctx.eligibility.feature) {
    return NextResponse.json(
      { error: ctx.eligibility.reason ?? 'Linked Accounts is not available for this venue.' },
      { status: 403 },
    );
  }

  try {
    const [links, outgoingPendingCount, invitationsByHost, invitationsSent] = await Promise.all([
      loadLinkViewsForVenue(ctx.admin, ctx.venueId),
      countOutgoingPendingRequests(ctx.admin, ctx.venueId),
      loadInvitationsByHost(ctx.admin, ctx.venueId),
      loadInvitationsSentByHost(ctx.admin, ctx.venueId),
    ]);
    // The collective invitation that rides on a pending request from its host, by link id
    // (Docs/link-and-collective-setup-wizard-plan.md, L11), so the review dialog can cover both.
    const proposedCollectives: Record<string, { id: string; name: string; slug: string; serviceModel: string }> = {};
    for (const link of links) {
      if (link.status !== 'pending') continue;
      if (link.initiatedByMe) {
        const sent = invitationsSent.get(link.otherVenue.id);
        if (sent) proposedCollectives[link.id] = { ...sent, serviceModel: 'replicas' };
        continue;
      }
      const invitation = invitationsByHost.get(link.otherVenue.id);
      if (invitation) {
        proposedCollectives[link.id] = {
          id: invitation.id,
          name: invitation.name,
          slug: invitation.slug,
          serviceModel: invitation.serviceModel,
        };
      }
    }
    return NextResponse.json({
      eligibility: ctx.eligibility,
      venue: { id: ctx.venue.id, name: ctx.venue.name, slug: ctx.venue.slug },
      links,
      outgoingPendingCount,
      maxOutgoingPending: MAX_PENDING_OUTGOING_REQUESTS,
      proposedCollectives,
    });
  } catch (err) {
    console.error('GET /api/venue/account-links failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** POST /api/venue/account-links: send a new link request (`createLinkRequest` holds the checks). */
export async function POST(request: NextRequest) {
  const resolved = await resolveLinkAdmin();
  if (!resolved.ok) return resolved.response;
  const { ctx } = resolved;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const parsed = createLinkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const created = await createLinkRequest(ctx, parsed.data, { notify: true });
    if (!created.ok) return created.response;
    const links = await loadLinkViewsForVenue(ctx.admin, ctx.venueId);
    return NextResponse.json({ link: links.find((l) => l.id === created.linkId) ?? null }, { status: 201 });
  } catch (err) {
    console.error('POST /api/venue/account-links failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
