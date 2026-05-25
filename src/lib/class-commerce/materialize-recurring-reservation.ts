import type { SupabaseClient } from '@supabase/supabase-js';
import { findOrCreateGuest } from '@/lib/guests';
import { insertFreeClassSessionBooking } from '@/lib/booking/insert-free-class-session-booking';
import { splitLegacyGuestName } from '@/lib/guests/name';
import {
  type ClassRecurringRule,
  parseClassRecurringRule,
  normaliseRuleStartTimeToPgTime,
} from '@/lib/class-commerce/recurring-rule-schema';

function addDaysYmd(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function ymdToWeekday(ymd: string): number {
  const d = new Date(`${ymd}T12:00:00Z`);
  return d.getUTCDay();
}

/** Next on-or-after `fromYmd` whose UTC weekday matches `weekday`. */
function nextOccurrenceOfWeekday(fromYmd: string, weekday: number): string {
  const cur = ymdToWeekday(fromYmd);
  const offset = (weekday - cur + 7) % 7;
  return addDaysYmd(fromYmd, offset);
}

export interface MaterializeRecurringReservationResult {
  status: 'success' | 'partial' | 'failed' | 'skipped';
  booking_ids: string[];
  /** Next calendar date the cron should consider this rule (always advances; null = exhausted). */
  next_materialize_on: string | null;
  message?: string;
}

const FORWARD_HORIZON_DAYS = 28;

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Materialise concrete bookings for a recurring reservation, honoring the rule
 * shape (weekday + start_time + end_date + max_occurrences + interval_weeks).
 *
 * Idempotent: skips dates the guest already has a booking for. Only books classes
 * with no online card requirement.
 */
export async function materializeRecurringReservation(
  admin: SupabaseClient,
  reservationId: string,
): Promise<MaterializeRecurringReservationResult> {
  const { data: res, error: rErr } = await admin
    .from('class_recurring_reservations')
    .select(
      'id, venue_id, user_id, class_type_id, status, next_materialize_on, last_materialized_at, rule',
    )
    .eq('id', reservationId)
    .maybeSingle();

  if (rErr || !res) {
    return {
      status: 'failed',
      booking_ids: [],
      next_materialize_on: addDaysYmd(todayYmd(), 7),
      message: 'Reservation not found',
    };
  }

  const row = res as {
    id: string;
    venue_id: string;
    user_id: string;
    class_type_id: string;
    status: string;
    next_materialize_on: string | null;
    last_materialized_at: string | null;
    rule: unknown;
  };

  if (row.status !== 'active') {
    return {
      status: 'skipped',
      booking_ids: [],
      next_materialize_on: addDaysYmd(todayYmd(), 7),
      message: 'Reservation not active',
    };
  }

  const rule: ClassRecurringRule | null = parseClassRecurringRule(row.rule);
  if (!rule) {
    return {
      status: 'failed',
      booking_ids: [],
      next_materialize_on: addDaysYmd(todayYmd(), 7),
      message: 'Invalid or missing rule',
    };
  }

  const { data: authUser, error: authErr } = await admin.auth.admin.getUserById(row.user_id);
  const email = authUser.user?.email?.trim().toLowerCase();
  if (authErr || !email) {
    return {
      status: 'failed',
      booking_ids: [],
      next_materialize_on: addDaysYmd(todayYmd(), 7),
      message: 'Could not resolve user email',
    };
  }

  const { data: profile } = await admin
    .from('user_profiles')
    .select('display_name, first_name, last_name')
    .eq('id', row.user_id)
    .maybeSingle();

  const prof = profile as
    | { display_name?: string | null; first_name?: string | null; last_name?: string | null }
    | null;
  const displayName =
    prof?.display_name?.trim() ||
    [prof?.first_name, prof?.last_name].filter(Boolean).join(' ').trim() ||
    email.split('@')[0] ||
    'Guest';

  const { data: venue, error: vErr } = await admin
    .from('venues')
    .select('id, name, address, email, reply_to_email, timezone')
    .eq('id', row.venue_id)
    .maybeSingle();

  if (vErr || !venue) {
    return {
      status: 'failed',
      booking_ids: [],
      next_materialize_on: addDaysYmd(todayYmd(), 7),
      message: 'Venue not found',
    };
  }

  const { data: ctRow, error: ctErr } = await admin
    .from('class_types')
    .select('payment_requirement, price_pence, deposit_amount_pence')
    .eq('id', row.class_type_id)
    .maybeSingle();

  if (ctErr || !ctRow) {
    return {
      status: 'failed',
      booking_ids: [],
      next_materialize_on: addDaysYmd(todayYmd(), 7),
      message: 'Class type not found',
    };
  }

  const ct = ctRow as {
    payment_requirement?: string;
    price_pence?: number | null;
    deposit_amount_pence?: number | null;
  };
  const payReq = ct.payment_requirement ?? 'none';
  const priceP = ct.price_pence ?? 0;
  const depPer = ct.deposit_amount_pence ?? 0;
  const requiresPaid =
    (payReq === 'full_payment' && priceP > 0) || (payReq === 'deposit' && depPer > 0 && priceP > 0);
  if (requiresPaid) {
    const today = todayYmd();
    const fromDateEarly =
      row.next_materialize_on && row.next_materialize_on >= today ? row.next_materialize_on : today;
    return {
      status: 'skipped',
      booking_ids: [],
      next_materialize_on: addDaysYmd(fromDateEarly, 7),
      message: 'Auto-booking is only supported for classes with no online card charge',
    };
  }

  // Window bounds.
  const today = todayYmd();
  const lastMatYmd = row.last_materialized_at
    ? row.last_materialized_at.slice(0, 10)
    : null;

  const earliestCandidate =
    lastMatYmd != null
      ? addDaysYmd(lastMatYmd, rule.interval_weeks * 7)
      : today;
  const fromDate = earliestCandidate < today ? today : earliestCandidate;

  let windowEnd = addDaysYmd(today, FORWARD_HORIZON_DAYS);
  if (rule.end_date && rule.end_date < windowEnd) windowEnd = rule.end_date;

  if (fromDate > windowEnd) {
    return {
      status: 'skipped',
      booking_ids: [],
      next_materialize_on: rule.end_date && rule.end_date <= today ? null : addDaysYmd(today, 7),
      message: 'Outside materialisation window',
    };
  }

  const ruleTimePg = normaliseRuleStartTimeToPgTime(rule.start_time);
  const intervalDays = rule.interval_weeks * 7;

  // Walk weekday occurrences in [fromDate, windowEnd].
  const targetDates: string[] = [];
  let cursor = nextOccurrenceOfWeekday(fromDate, rule.weekday);

  // If interval > 1 we need a stable phase anchor. Anchor to last_materialized_at
  // when present so fortnightly schedules don't drift.
  if (rule.interval_weeks > 1 && lastMatYmd) {
    const anchor = lastMatYmd;
    // Skip cursors that fall on the wrong week relative to anchor.
    while (cursor <= windowEnd) {
      const daysFromAnchor = Math.round(
        (new Date(`${cursor}T12:00:00Z`).getTime() - new Date(`${anchor}T12:00:00Z`).getTime()) /
          (24 * 60 * 60 * 1000),
      );
      if (daysFromAnchor % intervalDays === 0) break;
      cursor = addDaysYmd(cursor, 7);
    }
  }

  while (cursor <= windowEnd) {
    targetDates.push(cursor);
    cursor = addDaysYmd(cursor, intervalDays);
  }

  if (targetDates.length === 0) {
    return {
      status: 'skipped',
      booking_ids: [],
      next_materialize_on:
        rule.end_date && rule.end_date <= windowEnd ? null : addDaysYmd(windowEnd, 1),
      message: 'No matching dates in window',
    };
  }

  // Resolve class instances for those dates / start_time.
  const { data: instances, error: iErr } = await admin
    .from('class_instances')
    .select('id, instance_date, start_time, is_cancelled')
    .eq('class_type_id', row.class_type_id)
    .eq('is_cancelled', false)
    .eq('start_time', ruleTimePg)
    .in('instance_date', targetDates)
    .order('instance_date', { ascending: true });

  if (iErr) {
    console.error('[materializeRecurringReservation] instances', iErr);
    return {
      status: 'failed',
      booking_ids: [],
      next_materialize_on: addDaysYmd(fromDate, 7),
      message: 'Failed to load sessions',
    };
  }

  const instList = (instances ?? []) as Array<{
    id: string;
    instance_date: string;
    start_time: string;
  }>;

  if (instList.length === 0) {
    return {
      status: 'skipped',
      booking_ids: [],
      next_materialize_on:
        rule.end_date && rule.end_date <= windowEnd ? null : addDaysYmd(windowEnd, 1),
      message: 'No upcoming sessions match this rule',
    };
  }

  // max_occurrences cap — count bookings already attributed to this rule.
  let occurrencesAvailable = Infinity;
  if (rule.max_occurrences) {
    const { count } = await admin
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .eq('class_recurring_reservation_id', row.id);
    const used = count ?? 0;
    occurrencesAvailable = Math.max(0, rule.max_occurrences - used);
    if (occurrencesAvailable === 0) {
      return {
        status: 'skipped',
        booking_ids: [],
        next_materialize_on: null,
        message: 'max_occurrences reached',
      };
    }
  }

  // Build guest record (uses email as the auth link).
  const nameParts = splitLegacyGuestName(displayName);
  const { guest } = await findOrCreateGuest(
    admin,
    row.venue_id,
    {
      first_name: nameParts.first || null,
      last_name: nameParts.last || null,
      email,
      phone: null,
    },
    { silentAuthSignup: true },
  );

  const bookingIds: string[] = [];
  let failures = 0;

  for (const inst of instList) {
    if (occurrencesAvailable <= 0) break;

    const { data: existing } = await admin
      .from('bookings')
      .select('id')
      .eq('class_instance_id', inst.id)
      .eq('guest_id', guest.id)
      .maybeSingle();

    if (existing) continue;

    const ins = await insertFreeClassSessionBooking({
      admin,
      venueId: row.venue_id,
      venue: venue as Record<string, unknown>,
      guest,
      guestName: displayName,
      guestEmail: email,
      guestPhoneE164: '',
      classInstanceId: inst.id,
      partySize: 1,
      source: 'booking_page',
      groupBookingId: null,
      skipGuestNotifications: true,
      classRecurringReservationId: row.id,
    });

    if (ins.ok) {
      bookingIds.push(ins.bookingId);
      occurrencesAvailable -= 1;
    } else {
      failures += 1;
      console.warn('[materializeRecurringReservation] insert failed', inst.id, ins.error);
    }
  }

  const lastTargetDate = targetDates[targetDates.length - 1] ?? fromDate;
  const exhausted =
    occurrencesAvailable === 0 ||
    Boolean(rule.end_date && rule.end_date <= lastTargetDate);

  const nextMaterializeOn = exhausted ? null : addDaysYmd(lastTargetDate, intervalDays);

  let status: MaterializeRecurringReservationResult['status'];
  if (bookingIds.length > 0 && failures === 0) status = 'success';
  else if (bookingIds.length > 0) status = 'partial';
  else if (failures > 0) status = 'failed';
  else status = 'skipped';

  return {
    status,
    booking_ids: bookingIds,
    next_materialize_on: nextMaterializeOn,
    message:
      bookingIds.length === 0
        ? failures > 0
          ? 'Could not create bookings (capacity or rules)'
          : 'No new bookings needed'
        : undefined,
  };
}
