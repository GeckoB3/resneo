/**
 * Creating a pending link request (spec §6.1), factored out of `POST /api/venue/account-links` so the
 * one-call setup (`link-setup.ts`) can create the same row with the same checks and then decide
 * itself what to send the other venue (Docs/link-and-collective-setup-wizard-plan.md, L3 and L4).
 *
 * Every refusal is a ready `NextResponse`, so both callers answer the client the same way.
 */
import { NextResponse } from 'next/server';
import type { LinkAdminContext } from '@/lib/linked-accounts/route-helpers';
import {
  countOutgoingPendingRequests,
  findLiveLinkBetween,
  lastRejectedLinkBetween,
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
  type LinkGrant,
} from '@/lib/linked-accounts/types';

export type LinkAdminCtx = LinkAdminContext;

export interface LinkRequestInput {
  targetSlug: string;
  requestMessage?: string | null;
  grants: { mine: LinkGrant; theirs: LinkGrant };
}

export type LinkRequestResult =
  | {
      ok: true;
      linkId: string;
      target: { id: string; name: string; slug: string };
      mine: LinkGrant;
      theirs: LinkGrant;
      /** The bullets the request email lists, so a caller that sends its own notice can reuse them. */
      permissionBullets: string[];
    }
  | { ok: false; response: NextResponse };

const refuse = (error: string, status: number, field?: string): LinkRequestResult => ({
  ok: false,
  response: NextResponse.json({ error, ...(field ? { field } : {}) }, { status }),
});

/**
 * Validate and insert a pending link. With `notify`, the other venue is emailed as today; without it,
 * the caller sends its own notice (the setup flow sends one that also names the collective).
 */
export async function createLinkRequest(
  ctx: LinkAdminCtx,
  input: LinkRequestInput,
  opts: { notify: boolean },
): Promise<LinkRequestResult> {
  if (!ctx.eligibility.canCreate) {
    return refuse(ctx.eligibility.reason ?? 'New links cannot be created right now.', 403, 'plan');
  }
  const mine = normaliseGrant(input.grants.mine);
  const theirs = normaliseGrant(input.grants.theirs);
  if (!isLinkConfigurationValid(mine, theirs)) {
    return refuse('A link must grant access in at least one direction.', 400, 'level');
  }

  const slug = input.targetSlug.trim().toLowerCase();
  const { data: targetRow } = await ctx.admin
    .from('venues')
    .select(
      'id, name, slug, pricing_tier, plan_status, booking_model, subscription_current_period_end, billing_access_source',
    )
    .ilike('slug', slug)
    .maybeSingle();
  if (!targetRow) return refuse('No venue was found with that booking-page address.', 404, 'venue');

  const targetVenueId = targetRow.id as string;
  if (targetVenueId === ctx.venueId) return refuse('You cannot link a venue to itself.', 400, 'venue');

  const targetEligibility = evaluateLinkEligibility({
    pricing_tier: targetRow.pricing_tier as string | null,
    plan_status: targetRow.plan_status as string | null,
    booking_model: targetRow.booking_model as string | null,
    subscription_current_period_end: targetRow.subscription_current_period_end as string | null,
    billing_access_source: targetRow.billing_access_source as string | null,
  });
  if (!targetEligibility.feature) return refuse('That venue cannot use linked accounts.', 400, 'venue');
  if (!targetEligibility.canCreate) {
    return refuse('That venue cannot accept new links while its subscription is inactive.', 400, 'venue');
  }

  const existing = await findLiveLinkBetween(ctx.admin, ctx.venueId, targetVenueId);
  if (existing) {
    return refuse(
      existing.status === 'pending'
        ? 'There is already a pending request between these venues.'
        : 'These venues are already linked.',
      409,
      'venue',
    );
  }

  const outgoing = await countOutgoingPendingRequests(ctx.admin, ctx.venueId);
  if (outgoing >= MAX_PENDING_OUTGOING_REQUESTS) {
    return refuse(
      `You have reached the limit of ${MAX_PENDING_OUTGOING_REQUESTS} pending link requests. Wait for some to be answered before sending more.`,
      429,
      'venue',
    );
  }

  const rejected = await lastRejectedLinkBetween(ctx.admin, ctx.venueId, targetVenueId);
  if (rejected?.responded_at) {
    const cooldownMs = REJECTED_REQUEST_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
    if (Date.now() - new Date(rejected.responded_at).getTime() < cooldownMs) {
      return refuse(
        `This venue recently declined a request. You can try again after ${REJECTED_REQUEST_COOLDOWN_DAYS} days.`,
        429,
        'venue',
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
      request_message: input.requestMessage?.trim() || null,
      created_by_user_id: ctx.userId,
      ...columns,
    })
    .select('id')
    .single();
  if (insertErr || !inserted) {
    console.error('createLinkRequest insert failed:', insertErr?.message);
    return refuse('Failed to send link request.', 500);
  }

  const permissionBullets = [
    ...describeGrant(theirs).map((s) => `${ctx.venue.name} will be able to ${s}`),
    ...describeGrant(mine).map((s) => `Your venue will be able to ${s}`),
  ];
  if (opts.notify) {
    await notifyLinkRequestReceived(ctx.admin, targetVenueId, ctx.venue.name, permissionBullets);
  }

  return {
    ok: true,
    linkId: inserted.id as string,
    target: { id: targetVenueId, name: targetRow.name as string, slug: targetRow.slug as string },
    mine,
    theirs,
    permissionBullets,
  };
}
