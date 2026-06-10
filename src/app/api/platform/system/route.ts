import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { isPlatformAuthFailure, requirePlatformSuperuserAuth } from '@/lib/platform-api-auth';

/** Mirrors vercel.json crons — names match the route segment + withCronRunLogging job names. */
const KNOWN_CRON_JOBS: Array<{ name: string; schedule: string }> = [
  { name: 'send-communications', schedule: 'Every 15 min' },
  { name: 'deposit-reminder-2h', schedule: 'Every 30 min' },
  { name: 'auto-cancel-bookings', schedule: 'Every 30 min' },
  { name: 'booking-log-email', schedule: 'Every 15 min' },
  { name: 'expire-waitlist-offers', schedule: 'Every 5 min' },
  { name: 'dietary-digest', schedule: 'Daily 07:00' },
  { name: 'reconciliation', schedule: 'Daily 06:00' },
  { name: 'materialize-event-sessions', schedule: 'Daily 03:00' },
  { name: 'class-recurring-materialize', schedule: 'Daily 04:15' },
  { name: 'account-hard-delete', schedule: 'Daily 05:00' },
  { name: 'account-link-maintenance', schedule: 'Daily 04:30' },
  { name: 'class-credit-expiry', schedule: 'Daily 02:30' },
  { name: 'class-membership-period-reset', schedule: 'Daily 03:00' },
  { name: 'compliance-expiry', schedule: 'Daily 02:00' },
  { name: 'baseline-metrics-snapshot', schedule: 'Weekly Sun 03:00' },
  { name: 'sms-overage-billing', schedule: 'Monthly 1st 02:00' },
  { name: 'sales-monthly', schedule: 'Monthly 1st 04:00' },
];

/**
 * GET /api/platform/system
 * System health: DB latency, Stripe webhook receipts, cron job run history,
 * comms failures (24h), and platform-wide last booking.
 */
export async function GET() {
  const auth = await requirePlatformSuperuserAuth();
  if (isPlatformAuthFailure(auth)) return auth;

  const admin = getSupabaseAdminClient();
  const now = Date.now();
  const h24 = new Date(now - 24 * 3600000).toISOString();
  const d7 = new Date(now - 7 * 86400000).toISOString();

  try {
    // DB latency: time a trivial indexed query round-trip.
    const dbStart = Date.now();
    const { error: pingErr } = await admin
      .from('venues')
      .select('id', { count: 'exact', head: true });
    const dbLatencyMs = Date.now() - dbStart;

    const [
      lastWebhookRes,
      webhook24hRes,
      webhookTypes7dRes,
      cronRunsRes,
      commsFailures24hRes,
      lastBookingRes,
    ] = await Promise.all([
      admin
        .from('webhook_events')
        .select('stripe_event_id, event_type, processed_at')
        .order('processed_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from('webhook_events')
        .select('id', { count: 'exact', head: true })
        .gte('processed_at', h24),
      admin
        .from('webhook_events')
        .select('event_type, processed_at')
        .gte('processed_at', d7)
        .order('processed_at', { ascending: false })
        .limit(2000),
      admin
        .from('cron_runs')
        .select('job_name, started_at, finished_at, duration_ms, ok, status_code, detail')
        .order('finished_at', { ascending: false })
        .limit(400),
      admin
        .from('communication_logs')
        .select('id', { count: 'exact', head: true })
        .in('status', ['failed', 'bounced'])
        .gte('created_at', h24),
      admin
        .from('bookings')
        .select('created_at')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    // Webhook event-type counts over 7 days.
    const typeCounts = new Map<string, number>();
    for (const row of (webhookTypes7dRes.data ?? []) as Array<{ event_type: string }>) {
      typeCounts.set(row.event_type, (typeCounts.get(row.event_type) ?? 0) + 1);
    }

    // Latest run + recent failure count per cron job.
    const cronRuns = (cronRunsRes.data ?? []) as Array<{
      job_name: string;
      started_at: string;
      finished_at: string;
      duration_ms: number;
      ok: boolean;
      status_code: number | null;
      detail: string | null;
    }>;
    const latestByJob = new Map<string, (typeof cronRuns)[number]>();
    const failures7dByJob = new Map<string, number>();
    for (const run of cronRuns) {
      if (!latestByJob.has(run.job_name)) latestByJob.set(run.job_name, run);
      if (!run.ok && run.finished_at >= d7) {
        failures7dByJob.set(run.job_name, (failures7dByJob.get(run.job_name) ?? 0) + 1);
      }
    }

    const cronJobs = KNOWN_CRON_JOBS.map((job) => {
      const last = latestByJob.get(job.name) ?? null;
      return {
        name: job.name,
        schedule: job.schedule,
        last_run_at: last?.finished_at ?? null,
        last_ok: last?.ok ?? null,
        last_duration_ms: last?.duration_ms ?? null,
        last_status_code: last?.status_code ?? null,
        last_detail: last?.detail ?? null,
        failures_7d: failures7dByJob.get(job.name) ?? 0,
      };
    });

    // Include any jobs that logged runs but aren't in the known list (future-proofing).
    for (const [name, run] of latestByJob) {
      if (KNOWN_CRON_JOBS.some((j) => j.name === name)) continue;
      cronJobs.push({
        name,
        schedule: '—',
        last_run_at: run.finished_at,
        last_ok: run.ok,
        last_duration_ms: run.duration_ms,
        last_status_code: run.status_code,
        last_detail: run.detail,
        failures_7d: failures7dByJob.get(name) ?? 0,
      });
    }

    const lastWebhook = lastWebhookRes.data as
      | { stripe_event_id: string; event_type: string; processed_at: string }
      | null;

    return NextResponse.json({
      db: {
        ok: !pingErr,
        latency_ms: dbLatencyMs,
        error: pingErr?.message ?? null,
      },
      webhooks: {
        last_event_at: lastWebhook?.processed_at ?? null,
        last_event_type: lastWebhook?.event_type ?? null,
        events_24h: webhook24hRes.count ?? 0,
        by_type_7d: [...typeCounts.entries()]
          .map(([event_type, count]) => ({ event_type, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 12),
        note: 'Failed webhook deliveries are released for Stripe retry and will not appear here until they succeed.',
      },
      crons: cronJobs,
      comms: {
        failures_24h: commsFailures24hRes.count ?? 0,
      },
      activity: {
        last_booking_at:
          (lastBookingRes.data as { created_at?: string } | null)?.created_at ?? null,
      },
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[platform/system]', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
