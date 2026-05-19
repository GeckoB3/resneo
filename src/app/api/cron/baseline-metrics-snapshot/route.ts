import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { requireCronAuthorisation } from '@/lib/cron-auth';
import {
  captureVenueBaselineSnapshot,
  rolling90DayPeriod,
} from '@/lib/metrics/capture-venue-baseline-snapshot';

/**
 * POST /api/cron/baseline-metrics-snapshot
 * Weekly job: upsert rolling 90-day baseline metrics per active venue (P0.6).
 */
export async function GET(request: NextRequest) {
  return POST(request);
}

export async function POST(request: NextRequest) {
  const denied = requireCronAuthorisation(request);
  if (denied) return denied;

  try {
    const admin = getSupabaseAdminClient();
    const { from, to } = rolling90DayPeriod();

    const venueIds = new Set<string>();
    const pageSize = 1000;
    let offset = 0;
    for (;;) {
      const { data: venueRows, error: venueErr } = await admin
        .from('bookings')
        .select('venue_id')
        .gte('booking_date', from)
        .in('booking_model', ['practitioner_appointment', 'unified_scheduling'])
        .range(offset, offset + pageSize - 1);

      if (venueErr) {
        console.error('[cron baseline-metrics] venue discovery failed:', venueErr.message);
        return NextResponse.json({ error: 'Failed to list venues' }, { status: 500 });
      }

      for (const row of venueRows ?? []) {
        venueIds.add(row.venue_id as string);
      }
      if (!venueRows?.length || venueRows.length < pageSize) break;
      offset += pageSize;
    }

    const venueIdList = [...venueIds];
    let captured = 0;
    const errors: Array<{ venue_id: string; message: string }> = [];

    for (const venueId of venueIds) {
      try {
        await captureVenueBaselineSnapshot(admin, {
          venue_id: venueId,
          period_start: from,
          period_end: to,
          snapshot_kind: 'rolling_90d',
        });
        captured += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown error';
        console.error('[cron baseline-metrics] capture failed:', message, { venueId });
        errors.push({ venue_id: venueId, message });
      }
    }

    return NextResponse.json({
      ok: true,
      period: { from, to },
      venues_processed: venueIdList.length,
      captured,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    console.error('[cron baseline-metrics] failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
