import type { SupabaseClient } from '@supabase/supabase-js';

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
