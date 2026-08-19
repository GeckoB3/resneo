import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { requireCronAuthorisation } from '@/lib/cron-auth';
import { withCronRunLogging } from '@/lib/platform/cron-log';
import { checkScheduleHealth, reportScheduleHealth } from '@/lib/monitoring/schedule-health';

/**
 * Cron — scheduling data health.
 *
 * Runs the mirror-drift invariant that caught `[R3-82]` by hand, on a schedule. Reports to
 * Sentry when `calendar_date_overrides` has drifted from `practitioner_leave_periods`, or
 * when the check could not read what it needed.
 *
 * READ-ONLY ON PURPOSE. It would be easy to make this self-heal by re-running the backfill,
 * and that is the wrong shape for a first alarm: drift means something upstream is broken,
 * and silently repairing it every night would hide the cause while the symptom kept
 * returning. Repair is one idempotent statement a human can run once they have read the
 * report. If drift recurs after repair, that is the signal worth having.
 *
 * See Docs/Resneo_Scheduling_Resolver_Plan_August_2026.md §5.
 */
export const GET = withCronRunLogging('schedule-health', handleGet);

async function handleGet(request: NextRequest) {
  const denied = requireCronAuthorisation(request);
  if (denied) return denied;

  const admin = getSupabaseAdminClient();
  const result = await checkScheduleHealth(admin);
  reportScheduleHealth(result);

  const { drift, readErrors } = result;

  if (readErrors.length > 0) {
    return NextResponse.json(
      { ok: false, reason: 'unreadable', readErrors },
      // 200 so the cron platform does not retry a check that is reporting correctly.
      { status: 200 },
    );
  }

  return NextResponse.json({
    ok: drift?.healthy ?? false,
    leaveRows: drift?.leaveRows ?? 0,
    mirrorRows: drift?.mirrorRows ?? 0,
    leaveWithoutMirror: drift?.leaveWithoutMirror ?? [],
    orphanMirrorRows: drift?.orphanMirrorRows ?? [],
    unmirrorable: drift?.unmirrorable ?? [],
  });
}
