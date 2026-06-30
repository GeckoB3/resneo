import { NextRequest, NextResponse } from 'next/server';
import { resolveLinkAdmin } from '@/lib/linked-accounts/route-helpers';
import { evaluateLinkEligibility } from '@/lib/linked-accounts/eligibility';
import { findLiveLinkBetween } from '@/lib/linked-accounts/queries';

/**
 * GET /api/venue/account-links/lookup?slug=... — Admin-only venue lookup for the
 * "send link request" form. Returns only the display name for confirmation,
 * never any PII.
 */
export async function GET(request: NextRequest) {
  const resolved = await resolveLinkAdmin();
  if (!resolved.ok) return resolved.response;
  const { ctx } = resolved;

  if (!ctx.eligibility.feature) {
    return NextResponse.json({ error: 'Linked Accounts is not available.' }, { status: 403 });
  }

  const slug = (request.nextUrl.searchParams.get('slug') ?? '').trim().toLowerCase();
  if (!slug) {
    return NextResponse.json({ error: 'Missing slug' }, { status: 400 });
  }

  try {
    const { data: venue } = await ctx.admin
      .from('venues')
      .select(
        'id, name, slug, pricing_tier, plan_status, booking_model, subscription_current_period_end, billing_access_source',
      )
      .ilike('slug', slug)
      .maybeSingle();

    if (!venue) {
      return NextResponse.json({ found: false });
    }

    const venueId = venue.id as string;
    if (venueId === ctx.venueId) {
      return NextResponse.json({
        found: true,
        eligible: false,
        name: venue.name as string,
        slug: venue.slug as string,
        reason: 'This is your own venue.',
      });
    }

    const eligibility = evaluateLinkEligibility({
      pricing_tier: venue.pricing_tier as string | null,
      plan_status: venue.plan_status as string | null,
      booking_model: venue.booking_model as string | null,
      subscription_current_period_end: venue.subscription_current_period_end as string | null,
      billing_access_source: venue.billing_access_source as string | null,
    });

    let reason: string | null = null;
    let eligible = true;
    if (!eligibility.feature) {
      eligible = false;
      reason = 'This venue cannot use linked accounts.';
    } else if (!eligibility.canCreate) {
      eligible = false;
      reason = 'This venue cannot accept links while its subscription is inactive.';
    } else {
      const existing = await findLiveLinkBetween(ctx.admin, ctx.venueId, venueId);
      if (existing) {
        eligible = false;
        reason =
          existing.status === 'pending'
            ? 'There is already a pending request with this venue.'
            : 'You are already linked with this venue.';
      }
    }

    return NextResponse.json({
      found: true,
      eligible,
      name: venue.name as string,
      slug: venue.slug as string,
      reason,
    });
  } catch (err) {
    console.error('GET /api/venue/account-links/lookup failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
