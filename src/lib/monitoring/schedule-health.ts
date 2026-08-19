/**
 * Scheduled health check for the scheduling data the resolver depends on.
 *
 * The resolver plan's §5 names the absence of any observability as its largest honest gap:
 * no counter, no canary, no owner-comms step, so the first signal of a regression is a
 * support ticket. This is the first thing to close part of it.
 *
 * IT CHECKS ONE THING, DELIBERATELY: that `calendar_date_overrides` has not drifted from
 * `practitioner_leave_periods`. That drift is not hypothetical. It happened on both
 * environments within a day of Stage 6a's migration (`[R3-82]`), because a backfill is a
 * point-in-time snapshot and a dual-write only covers writes from its own deployment
 * onward, so the seam between them belongs to neither half. Nothing noticed. The invariant
 * below is what noticed, run by hand; this runs it on a schedule instead.
 *
 * WHY NOT ROW COUNTS. Equal counts prove nothing: "never inserted" and "inserted then
 * deleted" both leave the totals looking plausible. Only the set difference distinguishes
 * them, which is why this compares ids rather than sizes.
 *
 * ROWS THAT CANNOT BE MIRRORED ARE NOT DRIFT. The migration's backfill deliberately skips a
 * leave row with no matching `unified_calendars` row and one with an inverted time pair, and
 * the dual-write skips the first for the same reason. Counting those as drift would make
 * this alert permanently, which is the fastest way to teach someone to ignore it. They are
 * reported separately, as information rather than as a fault.
 *
 * See Docs/Resneo_Scheduling_Resolver_Plan_August_2026.md §4 Stage 6a and §5.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface LeaveRowForHealth {
  id: string;
  venue_id: string;
  practitioner_id: string | null;
  unavailable_start_time: string | null;
  unavailable_end_time: string | null;
}

export interface MirrorDriftReport {
  /** Leave rows that SHOULD have a mirror row and do not. Non-empty means drift. */
  leaveWithoutMirror: string[];
  /** Mirror rows whose leave row is gone. Non-empty means a delete did not propagate. */
  orphanMirrorRows: string[];
  /** Leave rows the backfill and dual-write both skip by design. Information, not a fault. */
  unmirrorable: Array<{ id: string; reason: 'no-calendar' | 'invalid-time-pair' }>;
  leaveRows: number;
  mirrorRows: number;
  healthy: boolean;
}

function timePairValid(row: LeaveRowForHealth): boolean {
  const { unavailable_start_time: s, unavailable_end_time: e } = row;
  if (s == null && e == null) return true;
  if (s == null || e == null) return false;
  return e > s;
}

/**
 * Pure drift computation. Kept separate from the fetch so the invariant can be tested
 * exhaustively without a database, which matters because it is the thing being trusted.
 *
 * `calendarKeys` holds `${venue_id}:${calendar_id}` for every calendar, matching the
 * migration's join on both columns rather than on the id alone.
 */
export function computeMirrorDrift(params: {
  leaveRows: readonly LeaveRowForHealth[];
  mirrorSourceLeaveIds: readonly string[];
  calendarKeys: ReadonlySet<string>;
}): MirrorDriftReport {
  const { leaveRows, mirrorSourceLeaveIds, calendarKeys } = params;
  const mirrored = new Set(mirrorSourceLeaveIds);
  const leaveIds = new Set(leaveRows.map((r) => r.id));

  const leaveWithoutMirror: string[] = [];
  const unmirrorable: MirrorDriftReport['unmirrorable'] = [];

  for (const row of leaveRows) {
    if (mirrored.has(row.id)) continue;

    if (!row.practitioner_id || !calendarKeys.has(`${row.venue_id}:${row.practitioner_id}`)) {
      unmirrorable.push({ id: row.id, reason: 'no-calendar' });
      continue;
    }
    if (!timePairValid(row)) {
      unmirrorable.push({ id: row.id, reason: 'invalid-time-pair' });
      continue;
    }
    leaveWithoutMirror.push(row.id);
  }

  const orphanMirrorRows = mirrorSourceLeaveIds.filter((id) => !leaveIds.has(id));

  return {
    leaveWithoutMirror,
    orphanMirrorRows,
    unmirrorable,
    leaveRows: leaveRows.length,
    mirrorRows: mirrorSourceLeaveIds.length,
    healthy: leaveWithoutMirror.length === 0 && orphanMirrorRows.length === 0,
  };
}

export interface ScheduleHealthResult {
  drift: MirrorDriftReport | null;
  /** Tables that could not be read. A check that cannot run must not report "healthy". */
  readErrors: string[];
}

/** Loads the three id sets and computes drift. Never throws. */
export async function checkScheduleHealth(admin: SupabaseClient): Promise<ScheduleHealthResult> {
  const readErrors: string[] = [];

  const [leaveRes, mirrorRes, calRes] = await Promise.all([
    admin
      .from('practitioner_leave_periods')
      .select('id, venue_id, practitioner_id, unavailable_start_time, unavailable_end_time'),
    admin.from('calendar_date_overrides').select('source_leave_id').not('source_leave_id', 'is', null),
    admin.from('unified_calendars').select('id, venue_id'),
  ]);

  if (leaveRes.error) readErrors.push(`practitioner_leave_periods: ${leaveRes.error.message}`);
  if (mirrorRes.error) readErrors.push(`calendar_date_overrides: ${mirrorRes.error.message}`);
  if (calRes.error) readErrors.push(`unified_calendars: ${calRes.error.message}`);

  // A partial read would compute drift from an incomplete set and could report a clean
  // system as broken, or a broken one as clean. Refuse to answer instead.
  if (readErrors.length > 0) return { drift: null, readErrors };

  const calendarKeys = new Set(
    ((calRes.data ?? []) as Array<{ id: string; venue_id: string }>).map((c) => `${c.venue_id}:${c.id}`),
  );

  const drift = computeMirrorDrift({
    leaveRows: (leaveRes.data ?? []) as LeaveRowForHealth[],
    mirrorSourceLeaveIds: ((mirrorRes.data ?? []) as Array<{ source_leave_id: string | null }>)
      .map((r) => r.source_leave_id)
      .filter((id): id is string => typeof id === 'string'),
    calendarKeys,
  });

  return { drift, readErrors: [] };
}

/** Reports an unhealthy result to Sentry. Never throws, and says what to do about it. */
export function reportScheduleHealth(result: ScheduleHealthResult): void {
  const { drift, readErrors } = result;
  if (readErrors.length === 0 && drift?.healthy) return;

  const summary =
    readErrors.length > 0
      ? `schedule health check could not run (${readErrors.join('; ')})`
      : `calendar_date_overrides has drifted from practitioner_leave_periods (${drift?.leaveWithoutMirror.length ?? 0} unmirrored, ${drift?.orphanMirrorRows.length ?? 0} orphaned)`;

  console.warn(`[schedule-health] ${summary}`);

  const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (typeof window !== 'undefined' || !dsn) return;

  void (async () => {
    try {
      const Sentry = await import('@sentry/nextjs');
      Sentry.captureException(new Error(`Schedule health: ${summary}`), {
        level: readErrors.length > 0 ? 'warning' : 'error',
        tags: { check: 'schedule-health' },
        fingerprint: ['schedule-health', readErrors.length > 0 ? 'unreadable' : 'mirror-drift'],
        extra: {
          leaveWithoutMirror: drift?.leaveWithoutMirror ?? null,
          orphanMirrorRows: drift?.orphanMirrorRows ?? null,
          unmirrorable: drift?.unmirrorable ?? null,
          readErrors,
          remedy:
            're-run the backfill INSERT from supabase/migrations/20270114120000_calendar_date_overrides.sql; it is idempotent. See the plan [R3-82].',
        },
      });
    } catch {
      // Reporting must never be the reason a cron fails.
    }
  })();
}
