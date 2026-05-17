import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { requireCronAuthorisation } from '@/lib/cron-auth';
import { evaluateLinkEligibility } from '@/lib/linked-accounts/eligibility';
import {
  notifyLinkExpired,
  notifyLinkResumed,
  notifyLinkSuspended,
} from '@/lib/linked-accounts/notifications';
import {
  PENDING_REQUEST_EXPIRY_DAYS,
  SUSPENDED_LINK_EXPIRY_DAYS,
} from '@/lib/linked-accounts/types';

interface VenueState {
  id: string;
  name: string;
  pricing_tier: string | null;
  plan_status: string | null;
  booking_model: string | null;
}

/**
 * GET /api/cron/account-link-maintenance — daily maintenance for linked accounts
 * (§6.3, §6.7): expire stale pending requests, suspend links when a venue's
 * subscription lapses, resume them on restore, and expire long-suspended links.
 */
export async function GET(request: NextRequest) {
  const denied = requireCronAuthorisation(request);
  if (denied) return denied;

  const admin = getSupabaseAdminClient();
  const results = {
    expired_requests: 0,
    suspended: 0,
    resumed: 0,
    expired_suspended: 0,
    terminated_ineligible: 0,
    errors: 0,
  };

  const venueCache = new Map<string, VenueState | null>();
  async function getVenue(id: string): Promise<VenueState | null> {
    if (venueCache.has(id)) return venueCache.get(id) ?? null;
    const { data } = await admin
      .from('venues')
      .select('id, name, pricing_tier, plan_status, booking_model')
      .eq('id', id)
      .maybeSingle();
    const state = data
      ? {
          id: data.id as string,
          name: (data.name as string) ?? 'A linked venue',
          pricing_tier: (data.pricing_tier as string | null) ?? null,
          plan_status: (data.plan_status as string | null) ?? null,
          booking_model: (data.booking_model as string | null) ?? null,
        }
      : null;
    venueCache.set(id, state);
    return state;
  }

  // ---- 1. Expire stale pending requests --------------------------------
  try {
    const cutoff = new Date(
      Date.now() - PENDING_REQUEST_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    const { data: stale } = await admin
      .from('account_links')
      .select('id, venue_low_id, venue_high_id')
      .eq('status', 'pending')
      .lt('created_at', cutoff);
    for (const link of stale ?? []) {
      try {
        await admin
          .from('account_links')
          .update({
            status: 'expired',
            termination_reason: 'request_expired',
            terminated_at: new Date().toISOString(),
          })
          .eq('id', link.id);
        const [low, high] = await Promise.all([
          getVenue(link.venue_low_id as string),
          getVenue(link.venue_high_id as string),
        ]);
        await Promise.allSettled([
          notifyLinkExpired(admin, link.venue_low_id as string, high?.name ?? 'the other venue'),
          notifyLinkExpired(admin, link.venue_high_id as string, low?.name ?? 'the other venue'),
        ]);
        results.expired_requests++;
      } catch (err) {
        console.error('[account-link-maintenance] expire request failed:', link.id, err);
        results.errors++;
      }
    }
  } catch (err) {
    console.error('[account-link-maintenance] expire-requests step failed:', err);
    results.errors++;
  }

  // ---- 2. Suspend / terminate accepted links on subscription lapse -----
  try {
    const { data: accepted } = await admin
      .from('account_links')
      .select('id, venue_low_id, venue_high_id')
      .eq('status', 'accepted');
    for (const link of accepted ?? []) {
      try {
        const low = await getVenue(link.venue_low_id as string);
        const high = await getVenue(link.venue_high_id as string);
        if (!low || !high) continue;

        const lowElig = evaluateLinkEligibility(low);
        const highElig = evaluateLinkEligibility(high);

        // Venue moved to an ineligible product (e.g. restaurant) — terminate.
        if (!lowElig.feature || !highElig.feature) {
          await admin
            .from('account_links')
            .update({
              status: 'expired',
              termination_reason: 'plan_ineligible',
              terminated_at: new Date().toISOString(),
              pending_change: null,
            })
            .eq('id', link.id);
          results.terminated_ineligible++;
          continue;
        }

        // A venue's subscription lapsed — suspend the link.
        if (!lowElig.canCreate || !highElig.canCreate) {
          const lapsed = !lowElig.canCreate ? low : high;
          await admin
            .from('account_links')
            .update({ status: 'suspended', suspended_at: new Date().toISOString() })
            .eq('id', link.id);
          await Promise.allSettled([
            notifyLinkSuspended(admin, link.venue_low_id as string, lapsed.name),
            notifyLinkSuspended(admin, link.venue_high_id as string, lapsed.name),
          ]);
          results.suspended++;
        }
      } catch (err) {
        console.error('[account-link-maintenance] suspend step failed:', link.id, err);
        results.errors++;
      }
    }
  } catch (err) {
    console.error('[account-link-maintenance] suspend step failed:', err);
    results.errors++;
  }

  // ---- 3. Resume / expire suspended links ------------------------------
  try {
    const { data: suspended } = await admin
      .from('account_links')
      .select('id, venue_low_id, venue_high_id, suspended_at')
      .eq('status', 'suspended');
    const expiryCutoff = Date.now() - SUSPENDED_LINK_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
    for (const link of suspended ?? []) {
      try {
        const low = await getVenue(link.venue_low_id as string);
        const high = await getVenue(link.venue_high_id as string);
        if (!low || !high) continue;
        const lowElig = evaluateLinkEligibility(low);
        const highElig = evaluateLinkEligibility(high);

        if (lowElig.canCreate && highElig.canCreate) {
          await admin
            .from('account_links')
            .update({ status: 'accepted', suspended_at: null })
            .eq('id', link.id);
          await Promise.allSettled([
            notifyLinkResumed(admin, link.venue_low_id as string, high.name),
            notifyLinkResumed(admin, link.venue_high_id as string, low.name),
          ]);
          results.resumed++;
          continue;
        }

        const suspendedAt = link.suspended_at
          ? new Date(link.suspended_at as string).getTime()
          : 0;
        if (suspendedAt && suspendedAt < expiryCutoff) {
          await admin
            .from('account_links')
            .update({
              status: 'expired',
              termination_reason: 'subscription_lapsed',
              terminated_at: new Date().toISOString(),
              pending_change: null,
            })
            .eq('id', link.id);
          results.expired_suspended++;
        }
      } catch (err) {
        console.error('[account-link-maintenance] resume step failed:', link.id, err);
        results.errors++;
      }
    }
  } catch (err) {
    console.error('[account-link-maintenance] resume step failed:', err);
    results.errors++;
  }

  return NextResponse.json({ ok: true, ...results });
}
