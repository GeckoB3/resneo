import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { isPlatformAuthFailure, requirePlatformSuperuserAuth } from '@/lib/platform-api-auth';
import { resolveSmsBillingPeriod } from '@/lib/sms-usage';
import { computeSmsMonthlyAllowance } from '@/lib/billing/sms-allowance';

function maskRecipient(recipient: string | null): string {
  if (!recipient) return '—';
  const r = recipient.trim();
  if (r.includes('@')) {
    const [local, domain] = r.split('@');
    const head = local.slice(0, 2);
    return `${head}${'*'.repeat(Math.max(1, local.length - 2))}@${domain}`;
  }
  if (r.length > 4) return `${'*'.repeat(r.length - 4)}${r.slice(-4)}`;
  return r;
}

/** First day (YYYY-MM-01) of the UTC month `monthsBack` months before now. */
function monthStartUtc(monthsBack = 0): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - monthsBack);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

interface SmsUsageRow {
  venue_id: string;
  billing_month: string;
  messages_sent: number;
  messages_included: number;
  overage_count: number;
  overage_amount_pence: number | null;
  stripe_period_start: string | null;
  stripe_period_end: string | null;
}

interface SmsVenueRow {
  id: string;
  name: string;
  pricing_tier: string | null;
  calendar_count: number | null;
  sms_monthly_allowance: number | null;
  subscription_current_period_start: string | null;
  subscription_current_period_end: string | null;
}

function isoEqual(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const am = Date.parse(a);
  const bm = Date.parse(b);
  return Number.isFinite(am) && Number.isFinite(bm) && am === bm;
}

/**
 * The venue's usage row for its CURRENT billing period — same resolution as
 * `getSmsMessagesSentThisMonthForVenue` (Settings → Plan): Stripe-period columns when the
 * venue has an active subscription period, calendar-month row otherwise. A naive
 * "billing_month = this month" filter misses venues whose Stripe period started last month.
 */
function usageRowForCurrentPeriod(venue: SmsVenueRow, rows: SmsUsageRow[]): SmsUsageRow | null {
  const period = resolveSmsBillingPeriod(venue);
  if (period.periodStartIso && period.periodEndIso) {
    return (
      rows.find(
        (r) =>
          isoEqual(r.stripe_period_start, period.periodStartIso) &&
          isoEqual(r.stripe_period_end, period.periodEndIso),
      ) ?? null
    );
  }
  return rows.find((r) => r.billing_month === period.billingMonth) ?? null;
}

/**
 * GET /api/platform/comms?days=7
 * Email/SMS delivery health: volumes and failure rates by channel, recent failures,
 * per-venue failure leaderboard, and current-month SMS usage/overage.
 */
export async function GET(req: NextRequest) {
  const auth = await requirePlatformSuperuserAuth();
  if (isPlatformAuthFailure(auth)) return auth;

  const admin = getSupabaseAdminClient();
  const daysParam = parseInt(req.nextUrl.searchParams.get('days') ?? '7', 10);
  const days = [7, 30, 90].includes(daysParam) ? daysParam : 7;
  const sinceIso = new Date(Date.now() - days * 86400000).toISOString();

  try {
    const FAILED = ['failed', 'bounced'];

    const [
      emailTotalRes,
      emailFailedRes,
      smsTotalRes,
      smsFailedRes,
      pendingRes,
      recentFailuresRes,
      smsUsageRes,
      venuesRes,
    ] = await Promise.all([
      admin
        .from('communication_logs')
        .select('id', { count: 'exact', head: true })
        .eq('channel', 'email')
        .gte('created_at', sinceIso),
      admin
        .from('communication_logs')
        .select('id', { count: 'exact', head: true })
        .eq('channel', 'email')
        .in('status', FAILED)
        .gte('created_at', sinceIso),
      admin
        .from('communication_logs')
        .select('id', { count: 'exact', head: true })
        .eq('channel', 'sms')
        .gte('created_at', sinceIso),
      admin
        .from('communication_logs')
        .select('id', { count: 'exact', head: true })
        .eq('channel', 'sms')
        .in('status', FAILED)
        .gte('created_at', sinceIso),
      admin
        .from('communication_logs')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending')
        .gte('created_at', sinceIso),
      admin
        .from('communication_logs')
        .select('id, venue_id, channel, message_type, recipient, status, error_message, created_at')
        .in('status', FAILED)
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false })
        .limit(50),
      // 13-month window comfortably covers any venue's current Stripe billing period
      // (rows are keyed by the month the period STARTED, including annual periods).
      admin
        .from('sms_usage')
        .select(
          'venue_id, billing_month, messages_sent, messages_included, overage_count, overage_amount_pence, stripe_period_start, stripe_period_end',
        )
        .gte('billing_month', monthStartUtc(13))
        .order('billing_month', { ascending: false }),
      admin
        .from('venues')
        .select(
          'id, name, pricing_tier, calendar_count, sms_monthly_allowance, subscription_current_period_start, subscription_current_period_end',
        )
        .order('name', { ascending: true }),
    ]);

    const failures = (recentFailuresRes.data ?? []) as Array<{
      id: string;
      venue_id: string | null;
      channel: string;
      message_type: string;
      recipient: string | null;
      status: string;
      error_message: string | null;
      created_at: string;
    }>;

    // Per-venue failure leaderboard + venue names for failures & SMS usage.
    const failureCountByVenue = new Map<string, number>();
    for (const f of failures) {
      if (!f.venue_id) continue;
      failureCountByVenue.set(f.venue_id, (failureCountByVenue.get(f.venue_id) ?? 0) + 1);
    }

    const smsUsage = (smsUsageRes.data ?? []) as SmsUsageRow[];
    const venues = (venuesRes.data ?? []) as SmsVenueRow[];

    const venueNameById = new Map<string, string>(venues.map((v) => [v.id, v.name]));

    const usageRowsByVenue = new Map<string, SmsUsageRow[]>();
    for (const row of smsUsage) {
      const list = usageRowsByVenue.get(row.venue_id);
      if (list) list.push(row);
      else usageRowsByVenue.set(row.venue_id, [row]);
    }

    // Every venue appears (zero-usage included); allowance falls back to the plan default
    // when the venue has no usage row yet this period.
    const smsUsageAllVenues = venues
      .map((v) => {
        const row = usageRowForCurrentPeriod(v, usageRowsByVenue.get(v.id) ?? []);
        const allowance =
          row?.messages_included ??
          v.sms_monthly_allowance ??
          computeSmsMonthlyAllowance(v.pricing_tier ?? 'appointments', v.calendar_count);
        return {
          venue_id: v.id,
          venue_name: v.name,
          messages_sent: row?.messages_sent ?? 0,
          messages_included: allowance,
          overage_count: row?.overage_count ?? 0,
          overage_amount_pence: row?.overage_amount_pence ?? 0,
        };
      })
      .sort((a, b) => b.messages_sent - a.messages_sent || a.venue_name.localeCompare(b.venue_name));

    const emailTotal = emailTotalRes.count ?? 0;
    const emailFailed = emailFailedRes.count ?? 0;
    const smsTotal = smsTotalRes.count ?? 0;
    const smsFailed = smsFailedRes.count ?? 0;

    return NextResponse.json({
      window_days: days,
      summary: {
        email_sent: emailTotal,
        email_failed: emailFailed,
        email_failure_rate_pct: emailTotal > 0 ? Math.round((emailFailed / emailTotal) * 1000) / 10 : 0,
        sms_sent: smsTotal,
        sms_failed: smsFailed,
        sms_failure_rate_pct: smsTotal > 0 ? Math.round((smsFailed / smsTotal) * 1000) / 10 : 0,
        pending: pendingRes.count ?? 0,
      },
      recent_failures: failures.map((f) => ({
        id: f.id,
        venue_name: f.venue_id ? venueNameById.get(f.venue_id) ?? '—' : '—',
        channel: f.channel,
        message_type: f.message_type,
        recipient_masked: maskRecipient(f.recipient),
        status: f.status,
        error_message: f.error_message,
        created_at: f.created_at,
      })),
      failure_leaderboard: [...failureCountByVenue.entries()]
        .map(([venueId, count]) => ({
          venue_name: venueNameById.get(venueId) ?? 'Deleted venue',
          failures: count,
        }))
        .sort((a, b) => b.failures - a.failures)
        .slice(0, 10),
      sms_usage_current_month: smsUsageAllVenues,
    });
  } catch (e) {
    console.error('[platform/comms]', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
