import type { SupabaseClient } from '@supabase/supabase-js';
import { computeClassAvailability, fetchClassInput } from '@/lib/availability/class-session-engine';
import { cancellationDeadlineHoursBefore } from '@/lib/booking/cancellation-deadline';
import { resolveCancellationNoticeHoursForCreate } from '@/lib/booking/resolve-cancellation-notice-hours';
import type { GuestRecord } from '@/lib/guests';
import type { ClassPaymentRequirement } from '@/types/booking-models';

function onlineChargePence(
  payReq: ClassPaymentRequirement,
  pricePence: number,
  depositPerPerson: number,
  partySize: number,
): number {
  if (payReq === 'full_payment' && pricePence > 0) return pricePence * partySize;
  if (payReq === 'deposit' && depositPerPerson > 0) return depositPerPerson * partySize;
  return 0;
}

export interface InsertPendingPaidClassSessionBookingParams {
  admin: SupabaseClient;
  venueId: string;
  venue: Record<string, unknown>;
  guest: GuestRecord;
  guestEmail: string | null;
  classInstanceId: string;
  partySize: number;
  source: 'online' | 'widget' | 'booking_page';
  groupBookingId: string;
  /**
   * Override the natural deposit/full charge with a discounted amount (e.g. member
   * discount applied at quote time). Must not exceed the natural charge.
   */
  overrideOnlineChargePence?: number;
  /**
   * Card-hold line (card-hold design doc §7.2): no money is due today, so the row is
   * inserted Pending/Pending with `deposit_amount_pence: NULL`; the chargeable no-show
   * fee lives on the `booking_card_holds` row, not here. The class type must be
   * configured `card_hold`. Ignores `overrideOnlineChargePence`.
   */
  cardHold?: boolean;
}

/**
 * Creates a **Pending** class_session booking awaiting its payment step:
 * - default: `deposit_amount_pence` set for Stripe money collection;
 * - `cardHold: true`: `deposit_amount_pence` NULL (card saved, nothing charged today).
 * No confirmation email — sent after `confirm-payment` / webhook.
 */
export async function insertPendingPaidClassSessionBooking(
  params: InsertPendingPaidClassSessionBookingParams,
): Promise<
  | {
      ok: true;
      bookingId: string;
      deposit_amount_pence: number | null;
      /** The resolved notice hours behind the row's cancellation_deadline (feeds hold consent text). */
      cancellation_notice_hours: number;
    }
  | { ok: false; status: number; error: string; code?: string }
> {
  const {
    admin,
    venueId,
    venue: _venue,
    guest,
    guestEmail,
    classInstanceId,
    partySize,
    source,
    groupBookingId,
    overrideOnlineChargePence,
    cardHold = false,
  } = params;

  const { data: inst, error: instErr } = await admin
    .from('class_instances')
    .select('id, instance_date, start_time, is_cancelled, class_type_id')
    .eq('id', classInstanceId)
    .maybeSingle();

  if (instErr || !inst) {
    return { ok: false, status: 404, error: 'Class session not found' };
  }

  const row = inst as unknown as {
    instance_date: string;
    start_time: string;
    is_cancelled: boolean;
    class_type_id: string;
  };

  if (row.is_cancelled) {
    return { ok: false, status: 409, error: 'This class session is not available' };
  }

  const { data: ctRow, error: ctErr } = await admin
    .from('class_types')
    .select('payment_requirement, price_pence, deposit_amount_pence, duration_minutes, name')
    .eq('id', row.class_type_id)
    .eq('venue_id', venueId)
    .maybeSingle();

  if (ctErr || !ctRow) {
    return { ok: false, status: 404, error: 'Class type not found' };
  }

  const ct = ctRow as {
    payment_requirement?: ClassPaymentRequirement;
    price_pence?: number | null;
    deposit_amount_pence?: number | null;
    duration_minutes?: number;
  };
  const payReq = ct.payment_requirement ?? 'none';
  const priceP = ct.price_pence ?? 0;
  const depPer = ct.deposit_amount_pence ?? 0;

  let depositPence: number | null;
  if (cardHold) {
    if (payReq !== 'card_hold') {
      return { ok: false, status: 400, error: 'This session does not take a card hold' };
    }
    depositPence = null;
  } else {
    const naturalDeposit = onlineChargePence(payReq, priceP, depPer, partySize);
    if (naturalDeposit <= 0) {
      return { ok: false, status: 400, error: 'This session does not require an online card payment' };
    }
    depositPence = naturalDeposit;
    if (
      typeof overrideOnlineChargePence === 'number' &&
      overrideOnlineChargePence >= 0 &&
      overrideOnlineChargePence <= naturalDeposit
    ) {
      depositPence = overrideOnlineChargePence;
    }
    if (depositPence <= 0) {
      return { ok: false, status: 400, error: 'This session does not require an online card payment' };
    }
  }

  const bookingDate = row.instance_date;
  const timeForDb =
    String(row.start_time).length === 5 ? `${String(row.start_time)}:00` : String(row.start_time);
  const timeStr = timeForDb.slice(0, 5);

  const input = await fetchClassInput({
    supabase: admin,
    venueId,
    date: bookingDate,
    forPublicBooking: true,
  });
  const result = computeClassAvailability(input);
  const cls = result.find((c) => c.instance_id === classInstanceId);
  if (!cls || cls.remaining < partySize) {
    return { ok: false, status: 409, error: 'This class is full or unavailable' };
  }

  const durationMin = ct.duration_minutes ?? 60;
  const [y, mo, d] = bookingDate.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const endDate = new Date(Date.UTC(y!, mo! - 1, d!, hh!, mm!, 0));
  endDate.setUTCMinutes(endDate.getUTCMinutes() + durationMin);
  const estimatedEndTime = endDate.toISOString();

  const refundWindowHours = await resolveCancellationNoticeHoursForCreate({
    supabase: admin,
    venueId,
    effectiveModel: 'class_session',
    classInstanceId,
  });
  const cancellation_deadline = cancellationDeadlineHoursBefore(bookingDate, timeForDb, refundWindowHours);
  const cancellationPolicySnapshot = {
    refund_window_hours: refundWindowHours,
    policy: `Full refund if cancelled ${refundWindowHours}+ hours before your booking start time. No refund within ${refundWindowHours} hours of the start or for no-shows.`,
  };

  const bookingInsert: Record<string, unknown> = {
    venue_id: venueId,
    guest_id: guest.id,
    booking_date: bookingDate,
    booking_time: timeForDb,
    party_size: partySize,
    booking_model: 'class_session',
    status: 'Pending',
    source,
    dietary_notes: null,
    occasion: null,
    special_requests: null,
    guest_email: guestEmail,
    deposit_amount_pence: depositPence,
    deposit_status: 'Pending',
    cancellation_deadline,
    cancellation_policy_snapshot: cancellationPolicySnapshot,
    estimated_end_time: estimatedEndTime,
    class_instance_id: classInstanceId,
    capacity_used: partySize,
    group_booking_id: groupBookingId,
  };

  const { data: booking, error: bookErr } = await admin
    .from('bookings')
    .insert(bookingInsert)
    .select('id')
    .single();

  if (bookErr || !booking) {
    console.error('[insertPendingPaidClassSessionBooking] insert failed', bookErr);
    const code = (bookErr as { code?: string } | null)?.code;
    const msg = (bookErr as { message?: string } | null)?.message ?? '';
    // Surface the DB capacity guard (`enforce_cde_capacity` raises SQLSTATE 23P01
    // / message 'CDE_CAPACITY') so callers can roll back and return a 409.
    if (code === '23P01' || msg.includes('CDE_CAPACITY')) {
      return { ok: false, status: 409, error: 'CDE_CAPACITY', code: '23P01' };
    }
    return { ok: false, status: 500, error: 'Failed to create booking' };
  }

  return {
    ok: true,
    bookingId: (booking as { id: string }).id,
    deposit_amount_pence: depositPence,
    cancellation_notice_hours: refundWindowHours,
  };
}
