import { NextRequest, NextResponse } from 'next/server';
import { resolveLinkAdmin } from '@/lib/linked-accounts/route-helpers';
import { createLinkSchema } from '@/lib/linked-accounts/validation';
import {
  countOutgoingPendingRequests,
  findLiveLinkBetween,
  lastRejectedLinkBetween,
  loadLinkViewsForVenue,
} from '@/lib/linked-accounts/queries';
import {
  describeGrant,
  grantsToColumns,
  isLinkConfigurationValid,
  normaliseGrant,
  orderVenuePair,
} from '@/lib/linked-accounts/permissions';
import { evaluateLinkEligibility } from '@/lib/linked-accounts/eligibility';
import { notifyLinkRequestReceived } from '@/lib/linked-accounts/notifications';
import {
  MAX_PENDING_OUTGOING_REQUESTS,
  REJECTED_REQUEST_COOLDOWN_DAYS,
} from '@/lib/linked-accounts/types';

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
    const [links, outgoingPendingCount] = await Promise.all([
      loadLinkViewsForVenue(ctx.admin, ctx.venueId),
      countOutgoingPendingRequests(ctx.admin, ctx.venueId),
    ]);
    return NextResponse.json({
      eligibility: ctx.eligibility,
      venue: { id: ctx.venue.id, name: ctx.venue.name, slug: ctx.venue.slug },
      links,
      outgoingPendingCount,
      maxOutgoingPending: MAX_PENDING_OUTGOING_REQUESTS,
    });
  } catch (err) {
    console.error('GET /api/venue/account-links failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** POST /api/venue/account-links — send a new link request. */
export async function POST(request: NextRequest) {
  const resolved = await resolveLinkAdmin();
  if (!resolved.ok) return resolved.response;
  const { ctx } = resolved;

  if (!ctx.eligibility.canCreate) {
    return NextResponse.json(
      { error: ctx.eligibility.reason ?? 'New links cannot be created right now.' },
      { status: 403 },
    );
  }

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

  const mine = normaliseGrant(parsed.data.grants.mine);
  const theirs = normaliseGrant(parsed.data.grants.theirs);
  if (!isLinkConfigurationValid(mine, theirs)) {
    return NextResponse.json(
      { error: 'A link must grant access in at least one direction.' },
      { status: 400 },
    );
  }

  try {
    const slug = parsed.data.targetSlug.trim().toLowerCase();
    const { data: targetRow } = await ctx.admin
      .from('venues')
      .select(
        'id, name, slug, pricing_tier, plan_status, booking_model, subscription_current_period_end, billing_access_source',
      )
      .ilike('slug', slug)
      .maybeSingle();

    if (!targetRow) {
      return NextResponse.json(
        { error: 'No venue was found with that booking-page address.' },
        { status: 404 },
      );
    }
    const targetVenueId = targetRow.id as string;
    if (targetVenueId === ctx.venueId) {
      return NextResponse.json({ error: 'You cannot link a venue to itself.' }, { status: 400 });
    }

    const targetEligibility = evaluateLinkEligibility({
      pricing_tier: targetRow.pricing_tier as string | null,
      plan_status: targetRow.plan_status as string | null,
      booking_model: targetRow.booking_model as string | null,
      subscription_current_period_end: targetRow.subscription_current_period_end as string | null,
      billing_access_source: targetRow.billing_access_source as string | null,
    });
    if (!targetEligibility.feature) {
      return NextResponse.json(
        { error: 'That venue cannot use linked accounts.' },
        { status: 400 },
      );
    }
    if (!targetEligibility.canCreate) {
      return NextResponse.json(
        { error: 'That venue cannot accept new links while its subscription is inactive.' },
        { status: 400 },
      );
    }

    const existing = await findLiveLinkBetween(ctx.admin, ctx.venueId, targetVenueId);
    if (existing) {
      const msg =
        existing.status === 'pending'
          ? 'There is already a pending request between these venues.'
          : 'These venues are already linked.';
      return NextResponse.json({ error: msg }, { status: 409 });
    }

    const outgoing = await countOutgoingPendingRequests(ctx.admin, ctx.venueId);
    if (outgoing >= MAX_PENDING_OUTGOING_REQUESTS) {
      return NextResponse.json(
        {
          error: `You have reached the limit of ${MAX_PENDING_OUTGOING_REQUESTS} pending link requests. Wait for some to be answered before sending more.`,
        },
        { status: 429 },
      );
    }

    const rejected = await lastRejectedLinkBetween(ctx.admin, ctx.venueId, targetVenueId);
    if (rejected?.responded_at) {
      const cooldownMs = REJECTED_REQUEST_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
      const elapsed = Date.now() - new Date(rejected.responded_at).getTime();
      if (elapsed < cooldownMs) {
        return NextResponse.json(
          {
            error: `This venue recently declined a request. You can try again after ${REJECTED_REQUEST_COOLDOWN_DAYS} days.`,
          },
          { status: 429 },
        );
      }
    }

    const { low, high } = orderVenuePair(ctx.venueId, targetVenueId);
    const requesterIsLow = ctx.venueId === low;
    const columns = grantsToColumns({
      venueLowId: low,
      venueHighId: high,
      lowGrants: requesterIsLow ? mine : theirs,
      highGrants: requesterIsLow ? theirs : mine,
    });

    const { data: inserted, error: insertErr } = await ctx.admin
      .from('account_links')
      .insert({
        venue_low_id: low,
        venue_high_id: high,
        requested_by_venue_id: ctx.venueId,
        status: 'pending',
        request_message: parsed.data.requestMessage?.trim() || null,
        created_by_user_id: ctx.userId,
        ...columns,
      })
      .select('id')
      .single();

    if (insertErr || !inserted) {
      console.error('POST /api/venue/account-links insert failed:', insertErr?.message);
      return NextResponse.json({ error: 'Failed to send link request.' }, { status: 500 });
    }

    const permissionBullets = [
      ...describeGrant(theirs).map((s) => `${ctx.venue.name} will be able to ${s}`),
      ...describeGrant(mine).map((s) => `Your venue will be able to ${s}`),
    ];
    await notifyLinkRequestReceived(
      ctx.admin,
      targetVenueId,
      ctx.venue.name,
      permissionBullets,
    );

    const links = await loadLinkViewsForVenue(ctx.admin, ctx.venueId);
    const created = links.find((l) => l.id === inserted.id) ?? null;
    return NextResponse.json({ link: created }, { status: 201 });
  } catch (err) {
    console.error('POST /api/venue/account-links failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
