import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { requireCronAuthorisation } from '@/lib/cron-auth';
import { withCronRunLogging } from '@/lib/platform/cron-log';
import { normalizeBookingLogEmailConfig } from '@/lib/reports/booking-log-email-config';
import { sendBookingLogEmail } from '@/lib/reports/send-booking-log-email';

const CRON_WINDOW_MINUTES = 15;

interface VenueRow {
  id: string;
  name: string;
  timezone: string | null;
  daily_booking_log_email_config: unknown;
}

function localParts(now: Date, timezone: string): { date: string; day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const hour = Number(get('hour'));
  const minute = Number(get('minute'));
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    day: dayMap[get('weekday')] ?? 0,
    minutes: hour * 60 + minute,
  };
}

function minutesFromTime(time: string): number {
  const [hour, minute] = time.split(':').map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
}

export async function GET(request: NextRequest) {
  return POST(request);
}

export const POST = withCronRunLogging('booking-log-email', handlePost);

async function handlePost(request: NextRequest) {
  const denied = requireCronAuthorisation(request);
  if (denied) return denied;

  try {
    const supabase = getSupabaseAdminClient();
    const now = new Date();
    const periodEndIso = now.toISOString();
    const periodStartIso = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    const { data: venues, error } = await supabase
      .from('venues')
      .select('id, name, timezone, daily_booking_log_email_config')
      .not('daily_booking_log_email_config', 'is', null);

    if (error) {
      console.error('[booking-log-email-cron] venue query failed:', error);
      return NextResponse.json({ error: 'Failed to load venues' }, { status: 500 });
    }

    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const venue of (venues ?? []) as VenueRow[]) {
      const config = normalizeBookingLogEmailConfig(venue.daily_booking_log_email_config);
      if (!config.enabled || !config.recipient_email) {
        skipped++;
        continue;
      }

      const timezone = venue.timezone || 'Europe/London';
      const current = localParts(now, timezone);
      const dueEntries = config.schedule.filter((entry) => {
        if (entry.day !== current.day) return false;
        const scheduled = minutesFromTime(entry.time);
        const delta = current.minutes - scheduled;
        return delta >= 0 && delta < CRON_WINDOW_MINUTES;
      });

      if (dueEntries.length === 0) {
        skipped++;
        continue;
      }

      for (const entry of dueEntries) {
        const scheduleKey = `${current.date}T${entry.time}`;
        const { data: delivery, error: deliveryError } = await supabase
          .from('booking_log_email_deliveries')
          .insert({
            venue_id: venue.id,
            schedule_key: scheduleKey,
            recipient_email: config.recipient_email,
            period_start: periodStartIso,
            period_end: periodEndIso,
            status: 'pending',
          })
          .select('id')
          .single();

        if (deliveryError || !delivery) {
          skipped++;
          continue;
        }

        try {
          await sendBookingLogEmail({
            supabase,
            venue,
            recipientEmail: config.recipient_email,
            periodStartIso,
            periodEndIso,
          });

          await supabase
            .from('booking_log_email_deliveries')
            .update({ status: 'sent', sent_at: new Date().toISOString() })
            .eq('id', delivery.id);
          sent++;
        } catch (sendErr) {
          failed++;
          const message = sendErr instanceof Error ? sendErr.message : String(sendErr);
          console.error('[booking-log-email-cron] send failed:', sendErr, { venueId: venue.id });
          await supabase
            .from('booking_log_email_deliveries')
            .update({ status: 'failed', error_message: message })
            .eq('id', delivery.id);
        }
      }
    }

    return NextResponse.json({ sent, skipped, failed });
  } catch (err) {
    console.error('booking-log-email cron failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
