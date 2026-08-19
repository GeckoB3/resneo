/**
 * Stage 6a dual-write: leave periods mirrored into `calendar_date_overrides`.
 *
 * `practitioner_leave_periods` stays AUTHORITATIVE. Every engine still reads it, and
 * nothing in this file changes what a guest or a member of staff sees. The mirror exists
 * so the new table is populated and current by the time Stage 6b makes it the only one,
 * because a table that starts empty at cut-over has no safe cut-over.
 *
 * EVERY FUNCTION HERE IS FAIL-SOFT, and that is the whole design constraint. A venue
 * saving a holiday must never be told it failed because a mirror row could not be written
 * to a table nothing reads yet. Each function reports and returns; none throws, none
 * returns a value the caller must check. The cost is that a mirror row can silently go
 * missing, which is why writes are repairable: see `mirrorLeaveUpdate`.
 *
 * The plan's `[R3-77]` originally justified fail-soft with a missing-table window that does
 * not exist -- the ritual applies migrations to production BEFORE the code arrives, not
 * after (corrected as `[R3-80]`). The real justification is the one above and it is
 * stronger: it holds in every environment, including a developer's machine with the
 * migration unapplied, and it does not depend on deploy ordering at all.
 *
 * See Docs/Resneo_Scheduling_Resolver_Plan_August_2026.md §4 Stage 6a.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/** The columns of a leave row this mirror needs. Structural, so both routes' shapes fit. */
export interface LeaveRowForMirror {
  id: string;
  venue_id: string;
  /** FK name is historical: it holds a `unified_calendars.id`. Null cannot be mirrored. */
  practitioner_id: string | null;
  start_date: string;
  end_date: string;
  leave_type?: string | null;
  notes?: string | null;
  unavailable_start_time: string | null;
  unavailable_end_time: string | null;
  created_at?: string | null;
}

interface MirrorError {
  message?: string | null;
  code?: string | null;
  details?: string | null;
  hint?: string | null;
}

/**
 * Records a mirror write that failed, and swallows it.
 *
 * Deliberately separate from `reportAvailabilityReadFailure`, which this mirrors in shape.
 * That one describes a READ that failed open and left the engine believing something false;
 * this one describes a WRITE to a table no engine reads yet. They want different
 * fingerprints and different urgency, and folding them together would make a mirror wobble
 * look like an availability outage.
 */
function reportMirrorFailure(source: string, leaveIds: string[], error: MirrorError | null): void {
  const message = error?.message ?? 'unknown error';
  console.warn(`[${source}] calendar_date_overrides mirror: ${message}`);

  if (typeof window !== 'undefined') return;
  const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;

  void (async () => {
    try {
      const Sentry = await import('@sentry/nextjs');
      Sentry.captureException(
        new Error(`calendar_date_overrides mirror write failed (${message})`),
        {
          level: 'warning',
          tags: { mirror_source: source, mirror_table: 'calendar_date_overrides' },
          fingerprint: ['calendar-date-overrides-mirror', source],
          extra: {
            leaveIds,
            consequence:
              'practitioner_leave_periods is authoritative and unaffected; the mirror row is missing and will be repaired on the next edit of this leave period.',
            code: error?.code ?? null,
            details: error?.details ?? null,
            hint: error?.hint ?? null,
          },
        },
      );
    } catch {
      // Reporting must never be the reason a leave save fails.
    }
  })();
}

/** Mirror-table row for one leave period, or null when the row cannot be represented. */
function overrideRowFor(leave: LeaveRowForMirror): Record<string, unknown> | null {
  // A leave row with no calendar has nothing to hang an override on. The migration's
  // backfill skips these the same way, by inner-joining `unified_calendars`.
  if (!leave.practitioner_id) return null;

  return {
    venue_id: leave.venue_id,
    calendar_id: leave.practitioner_id,
    override_kind: 'closed',
    date_start: leave.start_date,
    date_end: leave.end_date,
    time_start: leave.unavailable_start_time,
    time_end: leave.unavailable_end_time,
    leave_type: leave.leave_type ?? null,
    notes: leave.notes ?? null,
    source_leave_id: leave.id,
    // Omitted rather than null when absent, so the column default applies.
    ...(leave.created_at ? { created_at: leave.created_at } : {}),
  };
}

/**
 * Mirrors newly created leave periods. Call AFTER the authoritative insert has succeeded,
 * with the rows it returned.
 */
export async function mirrorLeaveInsert(
  admin: SupabaseClient,
  leaveRows: readonly LeaveRowForMirror[],
  source: string,
): Promise<void> {
  try {
    const rows = leaveRows.map(overrideRowFor).filter((r): r is Record<string, unknown> => r !== null);
    if (rows.length === 0) return;

    const { error } = await admin.from('calendar_date_overrides').insert(rows);
    if (error) reportMirrorFailure(source, leaveRows.map((r) => r.id), error);
  } catch (err) {
    reportMirrorFailure(source, leaveRows.map((r) => r.id), {
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Mirrors an edited leave period.
 *
 * Updates the existing mirror row, and INSERTS one when no row matched. That second half is
 * what makes the mirror self-repairing: a row lost to an earlier fail-soft insert comes back
 * the next time anyone edits that leave period, without a reconciliation job.
 */
export async function mirrorLeaveUpdate(
  admin: SupabaseClient,
  leave: LeaveRowForMirror,
  source: string,
): Promise<void> {
  try {
    const row = overrideRowFor(leave);
    if (!row) return;

    // `source_leave_id` is not a column to change on an update, and `created_at` should keep
    // the mirror row's own value rather than being rewritten from the leave row.
    const { source_leave_id: _src, created_at: _created, ...updates } = row;

    const { data, error } = await admin
      .from('calendar_date_overrides')
      .update(updates)
      .eq('source_leave_id', leave.id)
      .select('id');

    if (error) {
      reportMirrorFailure(source, [leave.id], error);
      return;
    }
    if (data && data.length > 0) return;

    const { error: insertErr } = await admin.from('calendar_date_overrides').insert([row]);
    if (insertErr) reportMirrorFailure(source, [leave.id], insertErr);
  } catch (err) {
    reportMirrorFailure(source, [leave.id], {
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Removes the mirror row for a deleted leave period. */
export async function mirrorLeaveDelete(
  admin: SupabaseClient,
  leaveId: string,
  venueId: string,
  source: string,
): Promise<void> {
  try {
    const { error } = await admin
      .from('calendar_date_overrides')
      .delete()
      .eq('source_leave_id', leaveId)
      .eq('venue_id', venueId);
    if (error) reportMirrorFailure(source, [leaveId], error);
  } catch (err) {
    reportMirrorFailure(source, [leaveId], {
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
