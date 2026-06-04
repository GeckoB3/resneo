import { NextRequest, NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { resolveLinkAdmin } from '@/lib/linked-accounts/route-helpers';
import { evaluateLinkEligibility } from '@/lib/linked-accounts/eligibility';
import { findLiveLinkBetween } from '@/lib/linked-accounts/queries';
import { createLinkInviteToken, verifyLinkInviteToken } from '@/lib/linked-accounts/invite-token';
import { resolvePublicSiteOriginFromRequest } from '@/lib/public-base-url';

const INVITE_PATH = '/dashboard/settings';

function inviteUrl(origin: string, token: string): string {
  const params = new URLSearchParams({ tab: 'linked-accounts', invite: token });
  return `${origin}${INVITE_PATH}?${params.toString()}`;
}

/**
 * POST /api/venue/account-links/invite — Admin generates a shareable invite link
 * (§20). The link encodes *this* venue and, when opened by an admin of another
 * eligible venue, pre-fills a link request back to here. It grants nothing on
 * its own and expires in 30 days. Returns the URL plus a QR data-URL.
 */
export async function POST(request: NextRequest) {
  const resolved = await resolveLinkAdmin();
  if (!resolved.ok) return resolved.response;
  const { ctx } = resolved;

  if (!ctx.eligibility.feature || !ctx.eligibility.canCreate) {
    return NextResponse.json(
      { error: ctx.eligibility.reason ?? 'Linking is not available on your current plan.' },
      { status: 403 },
    );
  }

  let token: string;
  try {
    token = createLinkInviteToken(ctx.venueId);
  } catch (err) {
    console.error('createLinkInviteToken failed:', err);
    return NextResponse.json(
      { error: 'Invite links are not configured. Please contact support.' },
      { status: 500 },
    );
  }

  const origin = resolvePublicSiteOriginFromRequest(request);
  const url = inviteUrl(origin, token);

  let qrDataUrl: string | null = null;
  try {
    qrDataUrl = await QRCode.toDataURL(url, { margin: 1, width: 240, errorCorrectionLevel: 'M' });
  } catch (err) {
    console.error('QR generation failed (non-fatal):', err);
  }

  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  return NextResponse.json({ url, qrDataUrl, expiresAt, venueName: ctx.venue.name });
}

/**
 * GET /api/venue/account-links/invite?token=... — Admin opens an invite link.
 * Verifies the token and returns the initiating venue's public display name +
 * slug and whether the viewer can link with it, so the client can pre-fill and
 * validate the send-request form. Never returns PII.
 */
export async function GET(request: NextRequest) {
  const resolved = await resolveLinkAdmin();
  if (!resolved.ok) return resolved.response;
  const { ctx } = resolved;

  if (!ctx.eligibility.feature) {
    return NextResponse.json({ error: 'Linked Accounts is not available.' }, { status: 403 });
  }

  const token = (request.nextUrl.searchParams.get('token') ?? '').trim();
  if (!token) return NextResponse.json({ valid: false, reason: 'invalid' });

  const verified = verifyLinkInviteToken(token);
  if (!verified.ok) {
    return NextResponse.json({ valid: false, reason: verified.reason });
  }

  try {
    const { data: venue } = await ctx.admin
      .from('venues')
      .select('id, name, slug, pricing_tier, plan_status, booking_model')
      .eq('id', verified.venueId)
      .maybeSingle();

    if (!venue) {
      return NextResponse.json({ valid: false, reason: 'invalid' });
    }

    // The invite encodes the initiator; if that's us, there's nothing to do.
    if ((venue.id as string) === ctx.venueId) {
      return NextResponse.json({
        valid: true,
        self: true,
        venueName: venue.name as string,
        venueSlug: venue.slug as string,
        eligible: false,
        reason: 'This is your own invite link.',
      });
    }

    const eligibility = evaluateLinkEligibility({
      pricing_tier: venue.pricing_tier as string | null,
      plan_status: venue.plan_status as string | null,
      booking_model: venue.booking_model as string | null,
    });

    let eligible = true;
    let reason: string | null = null;
    if (!eligibility.feature) {
      eligible = false;
      reason = 'This venue cannot use linked accounts.';
    } else if (!eligibility.canCreate) {
      eligible = false;
      reason = 'This venue cannot accept links right now.';
    } else {
      const existing = await findLiveLinkBetween(ctx.admin, ctx.venueId, venue.id as string);
      if (existing) {
        eligible = false;
        reason =
          existing.status === 'pending'
            ? 'A request with this venue is already pending.'
            : 'You are already linked with this venue.';
      }
    }

    return NextResponse.json({
      valid: true,
      self: false,
      venueName: venue.name as string,
      venueSlug: venue.slug as string,
      eligible,
      reason,
    });
  } catch (err) {
    console.error('GET /api/venue/account-links/invite failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
