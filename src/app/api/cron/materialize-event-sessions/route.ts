import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { requireCronAuthorisation } from '@/lib/cron-auth';
import { withCronRunLogging } from '@/lib/platform/cron-log';
import { getDayOfWeekForYmdInTimezone } from '@/lib/venue/venue-local-clock';

interface RecurrenceRule {
  type?: string;
  days?: number[];
  time?: string;
  times?: string[];
  duration_minutes?: number;
}

const HORIZON_DAYS = 120;

function addDays(ymd: string, n: number): string {
  const d = new Date(ymd + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function enumerateDates(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = new Date(start + 'T12:00:00Z'); d <= new Date(end + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/**
 * Expands recurring event/class calendars into event_sessions rows (idempotent via recurrence_key).
 */
export const GET = withCronRunLogging('materialize-event-sessions', handleGet);

async function handleGet(request: NextRequest) {
  const denied = requireCronAuthorisation(request);
  if (denied) return denied;

  const admin = getSupabaseAdminClient();
  const today = new Date().toISOString().slice(0, 10);
  const end = addDays(today, HORIZON_DAYS);

  const { data: calendars, error } = await admin
    .from('unified_calendars')
    .select('id, venue_id, capacity, recurrence_rule, calendar_type, venues(timezone)')
    .eq('is_active', true)
    .in('calendar_type', ['event', 'class'])
    .not('recurrence_rule', 'is', null);

  if (error) {
    console.error('[materialize-event-sessions]', error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  let created = 0;
  for (const cal of calendars ?? []) {
    const row = cal as {
      id: string;
      venue_id: string;
      capacity: number;
      recurrence_rule: RecurrenceRule | null;
      venues?: { timezone?: string | null } | null;
    };
    const rule = row.recurrence_rule;
    if (!rule || rule.type !== 'weekly' || !Array.isArray(rule.days) || rule.days.length === 0) continue;

    const tz =
      typeof row.venues?.timezone === 'string' && row.venues.timezone.trim() !== ''
        ? row.venues.timezone.trim()
        : 'Europe/London';

    const duration = (rule.duration_minutes ?? 60) as number;
    const timeList = rule.times?.length ? rule.times : rule.time ? [rule.time] : ['09:00'];

    for (const d of enumerateDates(today, end)) {
      const dow = getDayOfWeekForYmdInTimezone(d, tz);
      if (!rule.days.includes(dow)) continue;

      for (const t of timeList) {
        const startT = t.slice(0, 5);
        const endMin =
          parseInt(startT.slice(0, 2), 10) * 60 + parseInt(startT.slice(3, 5), 10) + duration;
        const eh = Math.floor(endMin / 60) % 24;
        const em = endMin % 60;
        const endTime = `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}:00`;

        const recurrenceKey = `${row.id}|${d}|${startT}|${duration}`;

        const { data: exists } = await admin
          .from('event_sessions')
          .select('id')
          .eq('calendar_id', row.id)
          .eq('recurrence_key', recurrenceKey)
          .maybeSingle();

        if (exists) continue;

        const { error: insErr } = await admin.from('event_sessions').insert({
          calendar_id: row.id,
          venue_id: row.venue_id,
          session_date: d,
          start_time: `${startT}:00`,
          end_time: endTime,
          recurrence_key: recurrenceKey,
          source: 'recurring',
          is_cancelled: false,
        });

        if (insErr) {
          if (insErr.code !== '23505') {
            console.warn('[materialize-event-sessions] insert', insErr.message);
          }
        } else {
          created++;
        }
      }
    }
  }

  return NextResponse.json({ ok: true, created_sessions: created });
}
