import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { requireCronAuthorisation } from '@/lib/cron-auth';
import { withCronRunLogging } from '@/lib/platform/cron-log';
import { materializeRecurringReservation } from '@/lib/class-commerce/materialize-recurring-reservation';

/**
 * Cron: process due `class_recurring_reservations` and create free class_session bookings where possible.
 */
export const GET = withCronRunLogging('class-recurring-materialize', handleGet);

async function handleGet(request: NextRequest) {
  const denied = requireCronAuthorisation(request);
  if (denied) return denied;

  const admin = getSupabaseAdminClient();
  const today = new Date().toISOString().slice(0, 10);

  const { data: rows, error } = await admin
    .from('class_recurring_reservations')
    .select('id, next_materialize_on')
    .eq('status', 'active')
    .not('next_materialize_on', 'is', null)
    .lte('next_materialize_on', today)
    .limit(40);

  if (error) {
    console.error('[cron/class-recurring-materialize]', error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  let processed = 0;
  for (const r of rows ?? []) {
    const id = (r as { id: string }).id;
    const result = await materializeRecurringReservation(admin, id);

    const lastError =
      result.status === 'success' ? null : result.message ?? (result.status === 'failed' ? 'materialization issue' : null);

    await admin
      .from('class_recurring_reservations')
      .update({
        last_materialized_at: new Date().toISOString(),
        last_error: lastError,
        next_materialize_on: result.next_materialize_on,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    const evStatus =
      result.status === 'success'
        ? 'success'
        : result.status === 'partial'
          ? 'partial'
          : result.status === 'skipped'
            ? 'skipped'
            : 'failed';

    const { error: evErr } = await admin.from('class_recurring_materialization_events').insert({
      reservation_id: id,
      status: evStatus,
      booking_ids: result.booking_ids,
      error: result.message ?? null,
    });
    if (evErr) {
      console.warn('[cron/class-recurring-materialize] event insert', evErr.message);
    }

    processed += 1;
  }

  return NextResponse.json({ ok: true, scanned: rows?.length ?? 0, processed });
}
