import { NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { isPlatformAuthFailure, requirePlatformSuperuserAuth } from '@/lib/platform-api-auth';
import {
  checkAccount,
  checkConnect,
  checkEnvPresence,
  checkKeyMode,
  checkPrices,
  checkWebhookEndpoints,
  rollupSeverity,
  type Severity,
} from '@/lib/stripe/health-checks';

export const dynamic = 'force-dynamic';

/** No subscription webhook in this long means the endpoint is probably broken. */
const STALE_WEBHOOK_HOURS = 48;

/**
 * GET /api/platform/stripe-health
 * Passive, read-only Stripe billing health: key mode consistency, platform account,
 * plan price validity, webhook endpoint configuration, recent webhook receipts, and
 * subscription-status drift. Safe to run in live mode (no writes, no charges).
 */
export async function GET() {
  const auth = await requirePlatformSuperuserAuth();
  if (isPlatformAuthFailure(auth)) return auth;

  const admin = getSupabaseAdminClient();
  const now = Date.now();
  const h24 = new Date(now - 24 * 3600000).toISOString();
  const staleCutoff = new Date(now - STALE_WEBHOOK_HOURS * 3600000).toISOString();

  try {
    const mode = checkKeyMode();
    const env = checkEnvPresence();

    const [account, connect, prices, endpoints, lastWebhookRes, webhook24hRes, billingRes] = await Promise.all([
      checkAccount(stripe),
      checkConnect(stripe),
      checkPrices(stripe),
      checkWebhookEndpoints(stripe, { mode: mode.secret_key_mode }),
      admin
        .from('webhook_events')
        .select('event_type, processed_at')
        .order('processed_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from('webhook_events')
        .select('id', { count: 'exact', head: true })
        .gte('processed_at', h24),
      admin.from('venues').select('plan_status').not('plan_status', 'is', null),
    ]);

    const lastWebhook = lastWebhookRes.data as { event_type: string; processed_at: string } | null;
    const lastEventAt = lastWebhook?.processed_at ?? null;
    const webhookStale = !lastEventAt || lastEventAt < staleCutoff;
    const dbWebhookSeverity: Severity = webhookStale ? 'warn' : 'ok';

    const byStatus = new Map<string, number>();
    for (const row of (billingRes.data ?? []) as Array<{ plan_status: string | null }>) {
      const s = row.plan_status ?? 'unknown';
      byStatus.set(s, (byStatus.get(s) ?? 0) + 1);
    }
    const pastDue = byStatus.get('past_due') ?? 0;
    const billingSeverity: Severity = pastDue > 0 ? 'warn' : 'ok';

    const overall = rollupSeverity([
      mode.severity,
      account.severity,
      connect.severity,
      env.severity,
      ...prices.map((p) => p.severity),
      ...endpoints.map((w) => w.severity),
      dbWebhookSeverity,
      billingSeverity,
    ]);

    return NextResponse.json({
      overall,
      mode,
      account,
      connect,
      prices,
      webhooks: {
        endpoints,
        db: {
          severity: dbWebhookSeverity,
          last_event_at: lastEventAt,
          last_event_type: lastWebhook?.event_type ?? null,
          events_24h: webhook24hRes.count ?? 0,
          stale_after_hours: STALE_WEBHOOK_HOURS,
          stale: webhookStale,
        },
      },
      billing: {
        severity: billingSeverity,
        by_status: [...byStatus.entries()]
          .map(([plan_status, count]) => ({ plan_status, count }))
          .sort((a, b) => b.count - a.count),
        past_due_count: pastDue,
      },
      env,
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[platform/stripe-health]', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
