import type { SupabaseClient } from '@supabase/supabase-js';
import { formatIsoDateInTimeZone } from '@/lib/date/format-iso-date-in-timezone';

/**
 * Earliest session start date (YYYY-MM-DD) for the given course, or null when the
 * course has no scheduled sessions yet.
 */
export async function earliestSessionDateForCourse(
  admin: SupabaseClient,
  courseProductId: string,
): Promise<string | null> {
  const { data: prod } = await admin
    .from('class_course_products')
    .select('session_instance_ids')
    .eq('id', courseProductId)
    .maybeSingle();
  const ids = ((prod as { session_instance_ids?: string[] | null } | null)?.session_instance_ids ?? []).filter(Boolean);
  if (ids.length === 0) return null;
  const { data: inst } = await admin
    .from('class_instances')
    .select('instance_date')
    .in('id', ids)
    .order('instance_date', { ascending: true })
    .limit(1);
  return ((inst ?? [])[0] as { instance_date?: string } | undefined)?.instance_date ?? null;
}

/**
 * The latest calendar date (YYYY-MM-DD) on which the guest can still cancel
 * for a free refund.
 *   cancellation_window_days NULL → null (not refundable)
 *   cancellation_window_days = 0 → first_session.instance_date
 *   cancellation_window_days = N → first_session.instance_date - N days
 */
export function cancelByDateFromWindow(
  firstSessionDate: string | null,
  cancellationWindowDays: number | null | undefined,
): string | null {
  if (firstSessionDate == null || cancellationWindowDays == null) return null;
  if (cancellationWindowDays === 0) return firstSessionDate;
  const d = new Date(`${firstSessionDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - cancellationWindowDays);
  return d.toISOString().slice(0, 10);
}

/** today (UTC) ≤ cancelByDate */
export function withinCancellationWindow(cancelByDate: string | null): boolean {
  if (!cancelByDate) return false;
  const todayYmd = new Date().toISOString().slice(0, 10);
  return todayYmd <= cancelByDate;
}

/**
 * Prorated refund (pence) for a course cancelled part-way through, charging the
 * guest only for sessions already delivered and refunding the remainder.
 *
 *   refund = round(pricePence * remainingSessions / totalSessions)
 *
 * - Zero sessions delivered (remaining === total) → full refund.
 * - All sessions delivered (remaining === 0) → zero refund.
 * - When totalSessions is 0/unknown we cannot prorate, so fall back to a full
 *   refund (the previous behaviour) rather than silently refunding nothing.
 * - The result is clamped to [0, pricePence] so float/rounding drift can never
 *   over-refund.
 */
export function computeProratedRefundPence(params: {
  pricePence: number;
  totalSessions: number;
  remainingSessions: number;
}): number {
  const pricePence = Math.max(0, Math.round(params.pricePence || 0));
  if (pricePence === 0) return 0;

  const total = Math.max(0, Math.trunc(params.totalSessions || 0));
  // No session schedule to prorate against → refund in full.
  if (total === 0) return pricePence;

  const remaining = Math.min(total, Math.max(0, Math.trunc(params.remainingSessions || 0)));
  if (remaining >= total) return pricePence;
  if (remaining === 0) return 0;

  const refund = Math.round((pricePence * remaining) / total);
  return Math.min(pricePence, Math.max(0, refund));
}

/**
 * Counts, for a single enrollment, how many linked sessions exist in total and
 * how many are still in the future (delivered sessions are those whose
 * `class_instances.instance_date` is strictly before "today" in the venue
 * timezone; an instance dated today still counts as remaining).
 *
 * Reads `class_course_session_enrollments` for the enrollment, then the
 * corresponding `class_instances.instance_date` values (two steps rather than a
 * PostgREST embed so it does not depend on the FK embed name). Returns
 * `{ total: 0, remaining: 0 }` when no sessions are linked (callers treat
 * total === 0 as "cannot prorate" → full refund).
 */
export async function countEnrollmentSessions(
  admin: SupabaseClient,
  params: { enrollmentId: string; venueTimezone: string | null | undefined },
): Promise<{ total: number; remaining: number }> {
  const { data: links, error: linkErr } = await admin
    .from('class_course_session_enrollments')
    .select('class_instance_id')
    .eq('enrollment_id', params.enrollmentId);

  if (linkErr) {
    console.error('[countEnrollmentSessions] links', linkErr);
    return { total: 0, remaining: 0 };
  }

  const instanceIds = [
    ...new Set(
      ((links ?? []) as Array<{ class_instance_id: string | null }>)
        .map((r) => r.class_instance_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  if (instanceIds.length === 0) return { total: 0, remaining: 0 };

  const { data: instances, error: instErr } = await admin
    .from('class_instances')
    .select('id, instance_date')
    .in('id', instanceIds);

  if (instErr) {
    console.error('[countEnrollmentSessions] instances', instErr);
    return { total: 0, remaining: 0 };
  }

  const tz = params.venueTimezone || 'UTC';
  const todayYmd = formatIsoDateInTimeZone(new Date(), tz);

  let total = 0;
  let remaining = 0;
  for (const inst of (instances ?? []) as Array<{ instance_date?: string | null }>) {
    const instanceDate = inst.instance_date;
    if (!instanceDate) continue;
    total += 1;
    // instance_date is YYYY-MM-DD; lexical compare is correct for ISO dates.
    if (instanceDate.slice(0, 10) >= todayYmd) remaining += 1;
  }

  return { total, remaining };
}
