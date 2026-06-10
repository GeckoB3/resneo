import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { requireCronAuthorisation } from '@/lib/cron-auth';
import { withCronRunLogging } from '@/lib/platform/cron-log';
import { evaluateLinkEligibility } from '@/lib/linked-accounts/eligibility';
import {
  notifyLinkExpired,
  notifyLinkLapseExpired,
  notifyLinkLapseWarning,
  notifyLinkResumed,
  notifyLinkSuspended,
  notifyLinkTerminatedIneligible,
} from '@/lib/linked-accounts/notifications';
import {
  PENDING_REQUEST_EXPIRY_DAYS,
  SUSPENDED_LINK_EXPIRY_DAYS,
} from '@/lib/linked-accounts/types';
import { reconcileCollectivesAfterLinkChange } from '@/lib/linked-accounts/collectives';
import { finalizeCronRun } from '@/lib/cron/finalize-cron-run';

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
export const GET = withCronRunLogging('account-link-maintenance', handleGet);

async function handleGet(request: NextRequest) {
  const denied = requireCronAuthorisation(request);
  if (denied) return denied;

  const admin = getSupabaseAdminClient();
  const results = {
    expired_requests: 0,
    lapse_warnings: 0,
    suspended: 0,
    resumed: 0,
    expired_suspended: 0,
    terminated_ineligible: 0,
    /** §16.1 #8 — count of failed email deliveries, folded into the cron health signal. */
    email_failures: 0,
    errors: 0,
  };

  /** Await notify promises, folding their send-failure counts into the health signal (§16.1 #8). */
  async function tallyEmails(
    promises: Array<Promise<{ emailFailures: number }>>,
  ): Promise<void> {
    const settled = await Promise.allSettled(promises);
    for (const s of settled) {
      if (s.status === 'fulfilled') results.email_failures += s.value.emailFailures;
      else results.errors++; // a notify wrapper itself threw — count it too
    }
  }

  /** Venues whose links left `accepted` this run — their collectives need re-checking (§7.5). */
  const collectiveAffectedVenueIds = new Set<string>();

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
        await tallyEmails([
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

  // ---- 1b. Advance lapse warnings (§6.7) -------------------------------
  // Email every venue linked to one whose subscription is foreseeably lapsing
  // ~7 days out: a scheduled cancellation, or a Light free period ending
  // without conversion. The 24h window means the daily cron warns exactly once.
  try {
    const now = Date.now();
    const windowStart = new Date(now + 6 * 24 * 60 * 60 * 1000).toISOString();
    const windowEnd = new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: cancelling } = await admin
      .from('venues')
      .select('id, name, subscription_current_period_end')
      .eq('plan_status', 'cancelling')
      .gte('subscription_current_period_end', windowStart)
      .lt('subscription_current_period_end', windowEnd);

    const { data: lightLapsing } = await admin
      .from('venues')
      .select('id, name, light_plan_free_period_ends_at')
      .is('light_plan_converted_at', null)
      .gte('light_plan_free_period_ends_at', windowStart)
      .lt('light_plan_free_period_ends_at', windowEnd);

    const lapsing = new Map<string, { name: string; effectiveDate: string }>();
    for (const v of cancelling ?? []) {
      lapsing.set(v.id as string, {
        name: (v.name as string) ?? 'A linked venue',
        effectiveDate: (v.subscription_current_period_end as string) ?? '',
      });
    }
    for (const v of lightLapsing ?? []) {
      if (lapsing.has(v.id as string)) continue;
      lapsing.set(v.id as string, {
        name: (v.name as string) ?? 'A linked venue',
        effectiveDate: (v.light_plan_free_period_ends_at as string) ?? '',
      });
    }

    for (const [venueId, info] of lapsing) {
      try {
        const dateLabel = info.effectiveDate
          ? new Date(info.effectiveDate).toLocaleDateString('en-GB', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })
          : 'soon';
        const { data: links } = await admin
          .from('account_links')
          .select('id, venue_low_id, venue_high_id, lapse_warning_sent_at')
          .eq('status', 'accepted')
          .or(`venue_low_id.eq.${venueId},venue_high_id.eq.${venueId}`);
        for (const link of links ?? []) {
          // §16.1 #7 — only warn once per lapse cycle. The flag is cleared when a
          // link resumes, so a future lapse will warn again.
          if (link.lapse_warning_sent_at) continue;
          const otherVenueId =
            (link.venue_low_id as string) === venueId
              ? (link.venue_high_id as string)
              : (link.venue_low_id as string);
          const warn = await notifyLinkLapseWarning(admin, otherVenueId, info.name, dateLabel);
          results.email_failures += warn.emailFailures;
          await admin
            .from('account_links')
            .update({ lapse_warning_sent_at: new Date().toISOString() })
            .eq('id', link.id as string);
          results.lapse_warnings++;
        }
      } catch (err) {
        console.error('[account-link-maintenance] lapse-warning failed:', venueId, err);
        results.errors++;
      }
    }
  } catch (err) {
    console.error('[account-link-maintenance] lapse-warning step failed:', err);
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
          collectiveAffectedVenueIds.add(link.venue_low_id as string);
          collectiveAffectedVenueIds.add(link.venue_high_id as string);
          // §6.6 — both venues are emailed when a link ends for plan ineligibility.
          await tallyEmails([
            notifyLinkTerminatedIneligible(admin, link.venue_low_id as string, high.name),
            notifyLinkTerminatedIneligible(admin, link.venue_high_id as string, low.name),
          ]);
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
          collectiveAffectedVenueIds.add(link.venue_low_id as string);
          collectiveAffectedVenueIds.add(link.venue_high_id as string);
          await tallyEmails([
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
            // Clear the lapse-warning flag (§16.1 #7) so a future lapse re-warns.
            .update({ status: 'accepted', suspended_at: null, lapse_warning_sent_at: null })
            .eq('id', link.id);
          await tallyEmails([
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
          collectiveAffectedVenueIds.add(link.venue_low_id as string);
          collectiveAffectedVenueIds.add(link.venue_high_id as string);
          // §6.7 — tell both venues the suspended link has now ended (relink needs a fresh request).
          await tallyEmails([
            notifyLinkLapseExpired(admin, link.venue_low_id as string, high.name),
            notifyLinkLapseExpired(admin, link.venue_high_id as string, low.name),
          ]);
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

  // ---- 4. Reconcile collectives whose links left 'accepted' (§7.5) -----
  if (collectiveAffectedVenueIds.size > 0) {
    try {
      await reconcileCollectivesAfterLinkChange(admin, [...collectiveAffectedVenueIds]);
    } catch (err) {
      console.error('[account-link-maintenance] collective reconcile failed:', err);
      results.errors++;
    }
  }

  const outcome = await finalizeCronRun({
    job: 'account-link-maintenance',
    results,
    // §16.1 #8 — failed deliveries count toward health so the run can't report
    // ok:true while emails silently failed.
    errors: results.errors + results.email_failures,
  });
  return NextResponse.json(outcome.body, { status: outcome.httpStatus });
}
