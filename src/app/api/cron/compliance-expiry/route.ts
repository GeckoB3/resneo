import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { requireCronAuthorisation } from '@/lib/cron-auth';
import { runComplianceExpiry } from '@/lib/compliance/expiry-cron';
import { runComplianceFormReminders } from '@/lib/compliance/auto-send';

/**
 * Nightly compliance job (spec §5.7 + improvement plan Phase 1 G3), registered in
 * vercel.json at `0 2 * * *`.
 *  1. Expire completed records whose expires_at has passed.
 *  2. Send a single expiry reminder (fresh link) per record within the venue's cadence.
 *  3. Chase pending form links for upcoming bookings (capped, throttled, stops on consume).
 */
export async function GET(request: NextRequest) {
  const denied = requireCronAuthorisation(request);
  if (denied) return denied;

  try {
    const admin = getSupabaseAdminClient();
    const result = await runComplianceExpiry(admin);
    const formReminders = await runComplianceFormReminders(admin);
    return NextResponse.json({
      ok: result.errors.length === 0 && formReminders.errors.length === 0,
      expired: result.expired,
      reminders_attempted: result.remindersAttempted,
      reminders_sent: result.remindersSent,
      form_reminders_sent: formReminders.sent,
      errors: [...result.errors, ...formReminders.errors],
    });
  } catch (err) {
    console.error('[cron/compliance-expiry] failed:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
