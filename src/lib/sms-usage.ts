import { getSupabaseAdminClient } from '@/lib/supabase';
import { computeSmsMonthlyAllowance } from '@/lib/billing/sms-allowance';
import { isSuperuserFreeBillingAccess } from '@/lib/billing/billing-access-source';

function billingMonthFirstDayUtcFromDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}-01`;
}

/** Pure helper: true when another counted send would exceed the inclusive cap. */
export function wouldExceedSmsQuota(used: number, allowance: number, additionalSends = 1): boolean {
  return used + additionalSends > allowance;
}

export function calculateSmsOverageDelta(
  usedBefore: number,
  allowance: number,
  additionalSegments: number,
): number {
  const before = Math.max(0, usedBefore - allowance);
  const after = Math.max(0, usedBefore + Math.max(1, additionalSegments) - allowance);
  return after - before;
}

type VenueSmsCountRow = {
  pricing_tier?: string | null;
  subscription_current_period_start?: string | null;
  subscription_current_period_end?: string | null;
};

type VenueSmsBillingRow = VenueSmsCountRow & {
  id?: string;
  billing_access_source?: string | null;
  sms_monthly_allowance?: number | null;
  calendar_count?: number | null;
  stripe_customer_id?: string | null;
};

type SmsBillingPeriod = {
  billingMonth: string;
  periodStartIso: string | null;
  periodEndIso: string | null;
  stripeTimestamp: number;
};

type SmsUsageIncrementResult = {
  usage_id?: string;
  overage_delta?: number;
  overage_count?: number;
  overage_reported_count?: number;
};

export function resolveSmsBillingPeriod(
  venue: VenueSmsCountRow,
  referenceDate = new Date(),
): SmsBillingPeriod {
  const periodStart = venue.subscription_current_period_start?.trim();
  const periodEnd = venue.subscription_current_period_end?.trim();
  if (periodStart && periodEnd) {
    const startMs = Date.parse(periodStart);
    const endMs = Date.parse(periodEnd);
    const refMs = referenceDate.getTime();
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && startMs <= refMs && refMs < endMs) {
      return {
        billingMonth: billingMonthFirstDayUtcFromDate(new Date(startMs)),
        periodStartIso: new Date(startMs).toISOString(),
        periodEndIso: new Date(endMs).toISOString(),
        stripeTimestamp: Math.floor(refMs / 1000),
      };
    }
  }
  return {
    billingMonth: billingMonthFirstDayUtcFromDate(referenceDate),
    periodStartIso: null,
    periodEndIso: null,
    stripeTimestamp: Math.floor(referenceDate.getTime() / 1000),
  };
}

async function sendStripeSmsUsageMeterEvent(opts: {
  stripeCustomerId: string;
  value: number;
  timestamp: number;
  idempotencyKey: string;
}): Promise<boolean> {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    console.error('[sms-usage] Stripe meter event skipped: STRIPE_SECRET_KEY is not configured');
    return false;
  }

  const value = Math.max(0, Math.floor(opts.value));
  if (value <= 0) return true;

  const params = new URLSearchParams();
  params.set('event_name', 'sms_usage_over_allowance');
  params.set('identifier', opts.idempotencyKey);
  params.set('timestamp', String(opts.timestamp));
  params.set('payload[stripe_customer_id]', opts.stripeCustomerId);
  params.set('payload[customer]', opts.stripeCustomerId);
  params.set('payload[value]', String(value));

  const res = await fetch('https://api.stripe.com/v1/billing/meter_events', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': opts.idempotencyKey,
    },
    body: params.toString(),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error('[sms-usage] Stripe meter event failed:', res.status, errText);
    return false;
  }

  return true;
}

function resolveSmsLogWindow(period: SmsBillingPeriod): { startIso: string; endIso: string } {
  if (period.periodStartIso && period.periodEndIso) {
    return { startIso: period.periodStartIso, endIso: period.periodEndIso };
  }

  const [yearRaw, monthRaw] = period.billingMonth.split('-');
  const year = Number(yearRaw);
  const monthIndex = Number(monthRaw) - 1;
  const start = new Date(Date.UTC(year, monthIndex, 1));
  const end = new Date(Date.UTC(year, monthIndex + 1, 1));
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

async function countLoggedSmsSegmentsForPeriod(opts: {
  venueId: string;
  period: SmsBillingPeriod;
}): Promise<number | null> {
  const admin = getSupabaseAdminClient();
  const window = resolveSmsLogWindow(opts.period);
  const { data, error } = await admin
    .from('sms_log')
    .select('segment_count')
    .eq('venue_id', opts.venueId)
    .gte('sent_at', window.startIso)
    .lt('sent_at', window.endIso);

  if (error) {
    console.error('[sms-usage] sms_log segment count failed:', error.message, { venueId: opts.venueId });
    return null;
  }

  return (data ?? []).reduce((total, row) => {
    const count = (row as { segment_count?: number | null }).segment_count;
    return total + Math.max(1, typeof count === 'number' ? count : 1);
  }, 0);
}

/**
 * SMS sends counted this month for quota checks (aligned with Settings → Plan tab).
 */
export async function getSmsMessagesSentThisMonthForVenue(
  venueId: string,
  venue: VenueSmsCountRow,
): Promise<number> {
  const admin = getSupabaseAdminClient();
  const period = resolveSmsBillingPeriod(venue);
  let query = admin
    .from('sms_usage')
    .select('messages_sent')
    .eq('venue_id', venueId);
  if (period.periodStartIso && period.periodEndIso) {
    query = query
      .eq('stripe_period_start', period.periodStartIso)
      .eq('stripe_period_end', period.periodEndIso);
  } else {
    query = query.eq('billing_month', period.billingMonth);
  }

  const { data: smsRow, error } = await query.maybeSingle();
  if (error) {
    console.error('[getSmsMessagesSentThisMonthForVenue] sms_usage read failed:', error.message, { venueId });
    return 0;
  }
  const usageCount = (smsRow as { messages_sent?: number } | null)?.messages_sent ?? 0;
  const loggedCount = await countLoggedSmsSegmentsForPeriod({ venueId, period });
  return Math.max(usageCount, loggedCount ?? 0);
}

async function markMeteredSegmentsReported(opts: {
  usageId: string;
  reportedCount: number;
}): Promise<void> {
  const admin = getSupabaseAdminClient();
  const { error } = await admin
    .from('sms_usage')
    .update({
      overage_reported_count: opts.reportedCount,
      overage_billed: true,
      last_stripe_meter_event_at: new Date().toISOString(),
    })
    .eq('id', opts.usageId);
  if (error) {
    console.error('[sms-usage] failed to mark meter event reported:', error.message, {
      usageId: opts.usageId,
    });
  }
}

export async function reportSmsOverageSegmentsToStripe(opts: {
  venueId: string;
  stripeCustomerId: string | null | undefined;
  usageId: string;
  overageDelta: number;
  overageCount: number;
  overageReportedCount: number;
  timestamp: number;
}): Promise<boolean> {
  const customerId = opts.stripeCustomerId?.trim();
  const delta = Math.max(0, Math.floor(opts.overageDelta));
  if (!customerId) {
    console.error('[sms-usage] Stripe meter event skipped: venue has no stripe_customer_id', {
      venueId: opts.venueId,
      usageId: opts.usageId,
    });
    return false;
  }
  if (delta <= 0) return false;

  const ok = await sendStripeSmsUsageMeterEvent({
    stripeCustomerId: customerId,
    value: delta,
    timestamp: opts.timestamp,
    idempotencyKey: `sms-overage:${opts.usageId}:${opts.overageReportedCount}:${opts.overageCount}`,
  });
  if (!ok) return false;

  await markMeteredSegmentsReported({
    usageId: opts.usageId,
    reportedCount: Math.max(opts.overageReportedCount + delta, opts.overageCount),
  });
  return true;
}

async function reportUsageIncrementIfBillable(opts: {
  venueId: string;
  venue: VenueSmsBillingRow;
  usage: SmsUsageIncrementResult | null | undefined;
  timestamp: number;
}): Promise<void> {
  if (isSuperuserFreeBillingAccess(opts.venue.billing_access_source)) return;
  if (!opts.usage?.usage_id || !opts.usage.overage_delta || !opts.usage.overage_count) return;

  await reportSmsOverageSegmentsToStripe({
    venueId: opts.venueId,
    stripeCustomerId: opts.venue.stripe_customer_id,
    usageId: opts.usage.usage_id,
    overageDelta: opts.usage.overage_delta,
    overageCount: opts.usage.overage_count,
    overageReportedCount: opts.usage.overage_reported_count ?? 0,
    timestamp: opts.timestamp,
  });
}

async function incrementSmsUsageForPeriod(opts: {
  venueId: string;
  period: SmsBillingPeriod;
  segmentCount: number;
}): Promise<SmsUsageIncrementResult | null> {
  const admin = getSupabaseAdminClient();
  const { data: usageRows, error } = await admin.rpc('increment_sms_usage', {
    p_venue_id: opts.venueId,
    p_billing_month: opts.period.billingMonth,
    p_segment_count: Math.max(1, opts.segmentCount),
    p_period_start: opts.period.periodStartIso,
    p_period_end: opts.period.periodEndIso,
  });

  if (error) {
    console.error('[sms-usage] increment_sms_usage failed:', error.message, { venueId: opts.venueId });
    return null;
  }

  return ((Array.isArray(usageRows) ? usageRows[0] : usageRows) as SmsUsageIncrementResult | null | undefined) ?? null;
}

async function insertSmsLogBestEffort(opts: {
  venueId: string;
  bookingId?: string;
  messageType: string;
  recipientPhone: string;
  twilioSid?: string;
  segmentCount: number;
}): Promise<void> {
  const admin = getSupabaseAdminClient();
  const row = {
    venue_id: opts.venueId,
    booking_id: opts.bookingId ?? null,
    message_type: opts.messageType,
    recipient_phone: opts.recipientPhone,
    twilio_message_sid: opts.twilioSid ?? null,
    status: 'sent',
    segment_count: opts.segmentCount,
  };

  const { error } = await admin.from('sms_log').insert(row);
  if (!error) return;

  if (opts.bookingId && error.code === '23503') {
    const retry = await admin.from('sms_log').insert({ ...row, booking_id: null });
    if (!retry.error) return;
    console.error('[sms-usage] sms_log insert retry failed:', retry.error.message, { venueId: opts.venueId });
    return;
  }

  console.error('[sms-usage] sms_log insert failed:', error.message, { venueId: opts.venueId });
}

export async function reconcileSmsUsageFromLogsForVenue(venueId: string): Promise<void> {
  const admin = getSupabaseAdminClient();
  const { data: venueRow, error: venueError } = await admin
    .from('venues')
    .select(
      'pricing_tier, billing_access_source, sms_monthly_allowance, calendar_count, stripe_customer_id, subscription_current_period_start, subscription_current_period_end',
    )
    .eq('id', venueId)
    .maybeSingle();

  if (venueError || !venueRow) {
    if (venueError) console.error('[sms-usage] reconcile venue read failed:', venueError.message, { venueId });
    return;
  }

  const venue = venueRow as VenueSmsBillingRow;
  const period = resolveSmsBillingPeriod(venue);
  const loggedSegments = await countLoggedSmsSegmentsForPeriod({ venueId, period });
  if (!loggedSegments) return;

  let usageQuery = admin.from('sms_usage').select('messages_sent').eq('venue_id', venueId);
  if (period.periodStartIso && period.periodEndIso) {
    usageQuery = usageQuery
      .eq('stripe_period_start', period.periodStartIso)
      .eq('stripe_period_end', period.periodEndIso);
  } else {
    usageQuery = usageQuery.eq('billing_month', period.billingMonth);
  }

  const { data: usageRow, error: usageError } = await usageQuery.maybeSingle();
  if (usageError) {
    console.error('[sms-usage] reconcile usage read failed:', usageError.message, { venueId });
    return;
  }

  const usageSegments = (usageRow as { messages_sent?: number } | null)?.messages_sent ?? 0;
  const missingSegments = loggedSegments - usageSegments;
  if (missingSegments <= 0) return;

  const usage = await incrementSmsUsageForPeriod({
    venueId,
    period,
    segmentCount: missingSegments,
  });
  await reportUsageIncrementIfBillable({
    venueId,
    venue,
    usage,
    timestamp: period.stripeTimestamp,
  });
}

async function reportSmsUsageBackfillRow(row: {
  id: string;
  venue_id: string;
  overage_count: number;
  overage_reported_count?: number | null;
  stripe_period_start?: string | null;
  stripe_period_end?: string | null;
  billing_month?: string | null;
}): Promise<boolean> {
  const admin = getSupabaseAdminClient();
  const { data: venue } = await admin
    .from('venues')
    .select('stripe_customer_id, billing_access_source')
    .eq('id', row.venue_id)
    .maybeSingle();
  const venueRow = venue as {
    stripe_customer_id?: string | null;
    billing_access_source?: string | null;
  } | null;
  if (isSuperuserFreeBillingAccess(venueRow?.billing_access_source)) return false;

  const delta = row.overage_count - (row.overage_reported_count ?? 0);
  if (delta <= 0) return false;

  let timestamp = Math.floor(Date.now() / 1000);
  const start = row.stripe_period_start ? Date.parse(row.stripe_period_start) : NaN;
  const end = row.stripe_period_end ? Date.parse(row.stripe_period_end) : NaN;
  if (Number.isFinite(start) && Number.isFinite(end)) {
    const safeMs = Math.max(start, Math.min(Date.now(), end - 1000));
    timestamp = Math.floor(safeMs / 1000);
  }

  return reportSmsOverageSegmentsToStripe({
    venueId: row.venue_id,
    stripeCustomerId: venueRow?.stripe_customer_id,
    usageId: row.id,
    overageDelta: delta,
    overageCount: row.overage_count,
    overageReportedCount: row.overage_reported_count ?? 0,
    timestamp,
  });
}

/**
 * For `billing_access_source = superuser_free`, block sends once included allowance is exhausted.
 * Paid Stripe accounts keep metered overage behaviour (no pre-send block here).
 */
export async function assertSmsSendWithinFreeAccessQuota(opts: {
  venueId: string;
  additionalSegments?: number;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const admin = getSupabaseAdminClient();
  const { data: venue, error } = await admin
    .from('venues')
    .select(
      'billing_access_source, sms_monthly_allowance, pricing_tier, calendar_count, subscription_current_period_start, subscription_current_period_end',
    )
    .eq('id', opts.venueId)
    .maybeSingle();
  if (error || !venue) {
    return { ok: true };
  }
  const row = venue as {
    billing_access_source?: string | null;
    sms_monthly_allowance?: number | null;
    pricing_tier?: string | null;
    calendar_count?: number | null;
    subscription_current_period_start?: string | null;
    subscription_current_period_end?: string | null;
  };
  if (!isSuperuserFreeBillingAccess(row.billing_access_source)) {
    return { ok: true };
  }
  const tier = row.pricing_tier ?? 'appointments';
  const allowance =
    row.sms_monthly_allowance ?? computeSmsMonthlyAllowance(tier, row.calendar_count ?? null);
  const used = await getSmsMessagesSentThisMonthForVenue(opts.venueId, row);
  const additionalSegments = Math.max(1, opts.additionalSegments ?? 1);
  if (wouldExceedSmsQuota(used, allowance, additionalSegments)) {
    return {
      ok: false,
      reason: `SMS allowance exhausted for this venue (${used}/${allowance} segments this period, free access).`,
    };
  }
  return { ok: true };
}

/**
 * Persist SMS to sms_log and increment monthly usage (metered billing data).
 */
export async function recordOutboundSms(opts: {
  venueId: string;
  bookingId?: string;
  messageType: string;
  recipientPhone: string;
  twilioSid?: string;
  segmentCount: number;
}): Promise<void> {
  try {
    const segmentCount = Math.max(1, opts.segmentCount);

    const admin = getSupabaseAdminClient();
    const { data: venueRow } = await admin
      .from('venues')
      .select(
        'pricing_tier, billing_access_source, sms_monthly_allowance, calendar_count, stripe_customer_id, subscription_current_period_start, subscription_current_period_end',
      )
      .eq('id', opts.venueId)
      .maybeSingle();

    const venue = (venueRow ?? {}) as VenueSmsBillingRow;
    const period = resolveSmsBillingPeriod(venue);

    const usage = await incrementSmsUsageForPeriod({
      venueId: opts.venueId,
      period,
      segmentCount,
    });

    await reportUsageIncrementIfBillable({
      venueId: opts.venueId,
      venue,
      usage,
      timestamp: period.stripeTimestamp,
    });

    await insertSmsLogBestEffort({
      venueId: opts.venueId,
      bookingId: opts.bookingId,
      messageType: opts.messageType,
      recipientPhone: opts.recipientPhone,
      twilioSid: opts.twilioSid,
      segmentCount,
    });
  } catch (err) {
    console.error('[recordOutboundSms] failed:', err);
  }
}

export async function reportUnreportedSmsUsageRows(): Promise<{ reported: number }> {
  const admin = getSupabaseAdminClient();
  const { data: rows, error } = await admin
    .from('sms_usage')
    .select(
      'id, venue_id, overage_count, overage_reported_count, stripe_period_start, stripe_period_end, billing_month',
    )
    .gt('overage_count', 0);

  if (error) {
    console.error('[reportUnreportedSmsUsageRows] query failed:', error.message);
    throw new Error(error.message);
  }

  let reported = 0;
  for (const row of rows ?? []) {
    const r = row as {
      id: string;
      venue_id: string;
      overage_count: number;
      overage_reported_count?: number | null;
      stripe_period_start?: string | null;
      stripe_period_end?: string | null;
      billing_month?: string | null;
    };
    if (r.overage_count <= (r.overage_reported_count ?? 0)) continue;
    if (await reportSmsUsageBackfillRow(r)) reported++;
  }

  return { reported };
}

export function estimateSmsSegments(body: string): number {
  const hasNonGsm = /[^\u0000-\u007F\u00A1-\u00FF]/.test(body);
  const limit = hasNonGsm ? 70 : 160;
  return Math.max(1, Math.ceil(body.length / limit));
}
