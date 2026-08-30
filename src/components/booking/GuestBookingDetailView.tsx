'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { bookingModelShortLabel } from '@/lib/booking/infer-booking-row-model';
import type { BookingModel } from '@/types/booking-models';
import type { BookingDetailDto } from '@/lib/booking/booking-detail-dto';
import type { GuestBookingDetailActor } from '@/lib/booking/guest-booking-actor';
import {
  buildGuestModifyRequest,
  readGuestModifyError,
  type GuestModifyChanges,
} from '@/lib/booking/guest-modify-request';
import { NumericInput } from '@/components/ui/NumericInput';
import { BrandSpinner, ConfirmDialog } from '@/components/ui/primitives';
import { GuestResourceModifySlotPicker } from '@/components/booking/GuestResourceModifySlotPicker';
import {
  GuestClassModifyInstancePicker,
  type GuestClassInstanceOption,
} from '@/components/booking/GuestClassModifyInstancePicker';
import { minutesBetweenStartAndEndHM } from '@/lib/booking/validate-appointment-modification';
import { formatCardHoldFeePence } from '@/lib/booking/card-hold-terms';
import { guestCardHoldHeldLine } from '@/lib/booking/guest-card-hold-summary';

/*
  P2-5a (Register Q-01). LAZY, because this view is what an emailed cancel
  link opens.

  A statically imported `AppointmentBookingFlow` is 5,903 lines and reaches
  `PaymentStep`, which reaches both Stripe packages, so a guest opening a link
  to CANCEL a booking downloaded the whole booking flow and a payment SDK
  before the page could paint. Measured before the change: this page's initial
  bundle was 1,331 KB and contained both, while the public booking page, which
  mounts the same component through `BookingFlowRouter`'s `dynamic()`, was
  364 KB and contained neither.

  It renders only after the guest presses "Change appointment", so nothing is
  waiting on it at first paint. Same shape as `BookingFlowRouter`, spinner
  included, so the two cannot drift.
*/
const AppointmentBookingFlow = dynamic(
  () =>
    import('@/components/booking/AppointmentBookingFlow').then((m) => ({
      default: m.AppointmentBookingFlow,
    })),
  {
    loading: () => (
      <div className="flex justify-center py-12" role="status" aria-label="Loading booking">
        <BrandSpinner />
      </div>
    ),
  },
);

/**
 * The payload this view reads, defined in exactly one place (P2-4 acceptance).
 *
 * It used to be a hand-written `BookingDetails` interface here, describing the
 * same body `GET /api/confirm` returns. Two declarations of one payload is how
 * a field gets added to the route and quietly stays `undefined` in the view,
 * so the interface is gone and this is an alias for the real thing. The local
 * name is kept only so the seven hundred lines below did not have to be
 * retyped to prove that.
 */
type BookingDetails = BookingDetailDto;

/**
 * Hand the guest the .ics the server built.
 *
 * A blob rather than a `data:` URL, matching `ConfirmationStep.tsx:54`, which
 * is the pattern already in this codebase for the same job.
 */
function downloadIcs(ics: string, bookingDate: string): void {
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `booking-${bookingDate}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function isCdeModel(m: BookingModel): boolean {
  return m === 'event_ticket' || m === 'class_session' || m === 'resource_booking';
}

type LinkErrorKind = 'expired' | 'used' | 'cancelled' | 'notFound' | 'invalid';

/**
 * Map the /api/confirm failure (status + message) to a clearer link-state card.
 * The confirm route currently emits generic messages for several cases, so we
 * key off the HTTP status first and fall back to message keywords — staying
 * forward-compatible if the API later distinguishes expired/cancelled.
 */
function classifyLinkError(linkError: { status: number; message: string } | null): {
  kind: LinkErrorKind;
  title: string;
  description: string;
  showReRequest: boolean;
} {
  const msg = (linkError?.message ?? '').toLowerCase();
  const status = linkError?.status ?? 0;

  let kind: LinkErrorKind = 'invalid';
  if (status === 410 || msg.includes('already been used') || msg.includes('already used')) {
    kind = 'used';
  } else if (msg.includes('expired')) {
    kind = 'expired';
  } else if (msg.includes('cancel')) {
    kind = 'cancelled';
  } else if (status === 404 || msg.includes('not found')) {
    kind = 'notFound';
  }

  switch (kind) {
    case 'used':
      return {
        kind,
        title: 'Link already used',
        description: 'This booking link has already been used and is no longer active.',
        showReRequest: true,
      };
    case 'expired':
      return {
        kind,
        title: 'Link expired',
        description: 'This booking link has expired for your security.',
        showReRequest: true,
      };
    case 'cancelled':
      return {
        kind,
        title: 'Booking cancelled',
        description: 'This booking has already been cancelled.',
        showReRequest: false,
      };
    case 'notFound':
      return {
        kind,
        title: 'Booking not found',
        description: "We couldn't find a booking for this link. It may have been removed.",
        showReRequest: false,
      };
    default:
      return {
        kind,
        title: 'Invalid link',
        description:
          linkError?.message && linkError.message !== 'Invalid link'
            ? linkError.message
            : "This booking link isn't valid. Please check the link or request a new one.",
        showReRequest: true,
      };
  }
}

interface Slot {
  key: string;
  label: string;
  start_time: string;
  available_covers: number;
}

/**
 * Re-exported so every existing importer is untouched. The declaration moved
 * to `@/lib/booking/guest-booking-actor` in P2-3 because `AppointmentBookingFlow`
 * needs it too, and this file imports that flow.
 */
export type { GuestBookingDetailActor };

/**
 * One booking, as its guest sees it, on both surfaces that show it (AD9).
 *
 * This was `ManageBookingView` under `/manage`, and it is unchanged apart from
 * where it gets its data and who is allowed to act. The reason it moved is that
 * the copy below is the cancellation and refund POLICY: rebuilding a second
 * full-fidelity detail page under `/account` would have meant maintaining two
 * renderings of that policy forever and policing the difference with tests.
 * One rendering makes the two surfaces agree by construction.
 *
 * **The actions are still the token surface's.** P2-4 is scoped as a pure
 * extraction: the plan has P2-2 and P2-3 supply the session handlers, so a
 * session actor renders the booking and not the buttons. Rendering a Cancel
 * that posts to `/api/confirm` without a token would be an affordance that
 * cannot work, which is worse than not offering it yet.
 */
export function GuestBookingDetailView({
  bookingId,
  actor,
  initialDetail,
  chrome: chromeProp,
}: {
  bookingId: string;
  actor: GuestBookingDetailActor;
  /** The portal already has the DTO server-side; passing it skips a fetch. */
  initialDetail?: BookingDetails | null;
  /**
   * `standalone` is the emailed link's own page, which needs a wordmark and a
   * footer because there is no other chrome around it. `embedded` is inside the
   * portal, which already has both; rendering them again would put a second
   * ResNeo logo halfway down a page that opens with one.
   *
   * Defaulted to `standalone` so the token surface, and the snapshots that
   * pin it, are untouched by this prop existing.
   */
  chrome?: 'standalone' | 'embedded';
}) {
  const standalone = (chromeProp ?? 'standalone') === 'standalone';
  const token = actor.kind === 'token' ? actor.token : undefined;
  const hmac = actor.kind === 'hmac' ? actor.hmac : undefined;
  const [details, setDetails] = useState<BookingDetails | null>(initialDetail ?? null);
  const [loading, setLoading] = useState(!initialDetail);
  const [error, setError] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<{ status: number; message: string } | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [refundMessage, setRefundMessage] = useState<string | null>(null);
  const [cardHoldMessage, setCardHoldMessage] = useState<string | null>(null);
  const [cardHoldKept, setCardHoldKept] = useState(false);
  const [showModify, setShowModify] = useState(false);
  const [modifySuccess, setModifySuccess] = useState(false);

  const authParam = hmac
    ? `hmac=${encodeURIComponent(hmac)}`
    : `token=${encodeURIComponent(token ?? '')}`;

  const fetchDetails = useCallback(async () => {
    const base = typeof window !== 'undefined' ? window.location.origin : '';
    /*
      Two ways in, one payload out. `GET /api/confirm` proves a token or an
      HMAC; `GET /api/v1/me/bookings/[id]` proves a session. Since P2-4 both
      answer with the SAME booking DTO (`src/lib/booking/booking-detail-dto.ts`),
      which is what lets one component read either.
    */
    const url =
      actor.kind === 'session'
        ? `${base}/api/v1/me/bookings/${encodeURIComponent(bookingId)}`
        : `${base}/api/confirm?booking_id=${encodeURIComponent(bookingId)}&${authParam}`;
    const res = await fetch(url);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      const message = (j as { error?: string }).error ?? 'Invalid link';
      setLinkError({ status: res.status, message });
      throw new Error(message);
    }
    setLinkError(null);
    setDetails(await res.json());
  }, [bookingId, authParam, actor.kind]);

  useEffect(() => {
    // The portal renders server-side and hands the DTO in, so there is nothing
    // to fetch on mount; a refresh after an action still goes through here.
    if (initialDetail) return;
    fetchDetails().catch((e) => setError(e instanceof Error ? e.message : 'Invalid link')).finally(() => setLoading(false));
  }, [fetchDetails, initialDetail]);

  const handleCancel = useCallback(async () => {
    setCancelling(true);
    const base = typeof window !== 'undefined' ? window.location.origin : '';
    try {
      /*
        Two transports, one outcome (P2-2). The token surface posts its proof to
        `/api/confirm`; the portal posts to its own route, which proves the
        session and calls the SAME `cancelBookingForGuest`. Both come back with
        the same body, which is what lets everything below this line be shared.
      */
      const res =
        actor.kind === 'session'
          ? await fetch(`${base}/api/account/bookings/${encodeURIComponent(bookingId)}/cancel`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({}),
            })
          : await fetch(`${base}/api/confirm`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                booking_id: bookingId,
                ...(hmac ? { hmac } : { token }),
                action: 'cancel',
              }),
            });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed');
      setCancelled(true);
      if (data.refund_message) setRefundMessage(data.refund_message);
      if (data.card_hold_message) setCardHoldMessage(data.card_hold_message);
      if (data.card_hold_kept) setCardHoldKept(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setCancelling(false);
    }
  }, [bookingId, token, hmac, actor.kind]);

  /**
   * A modify succeeded, but the guest is still reading the flow's own confirmation.
   * Refresh the details behind it so the summary tiles above show the new date and time
   * rather than the old ones. Deliberately does NOT close the flow: `handleModifySaved`
   * does that, and it only ever fires from the staff "Done" footer.
   */
  const handleModifyRefresh = useCallback(() => {
    fetchDetails().catch((e) =>
      console.error('[ManageBookingView] post-modify refresh failed:', e),
    );
  }, [fetchDetails]);

  const handleModifySaved = useCallback(() => {
    setShowModify(false);
    setModifySuccess(true);
    fetchDetails().catch((e) => console.error('[ManageBookingView] post-modify refresh failed:', e));
    setTimeout(() => setModifySuccess(false), 4000);
  }, [fetchDetails]);

  if (loading) {
    return (
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <div className="flex justify-center">
            <BrandSpinner />
          </div>
        </div>
      </div>
    );
  }

  if (error && !details) {
    const info = classifyLinkError(linkError);
    return (
      <div className="w-full max-w-md text-center">
        <div className="rounded-2xl border border-red-200 bg-white p-8 shadow-sm">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-50">
            <svg className="h-6 w-6 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" /></svg>
          </div>
          <h2 className="text-lg font-semibold text-slate-900">{info.title}</h2>
          <p className="mt-1 text-sm text-slate-500">{info.description}</p>
          {info.showReRequest && (
            <p className="mt-2 text-xs text-slate-400">
              Check your inbox for a more recent email, or contact the venue to resend your booking link.
            </p>
          )}
          <Link href="/" className="mt-4 inline-block text-sm font-medium text-brand-600 hover:text-brand-700">Go home</Link>
        </div>
      </div>
    );
  }

  if (cancelled) {
    const appt = details?.is_appointment;
    const cde = details?.booking_model ? isCdeModel(details.booking_model) : false;
    const title =
      appt && !cde ? 'Appointment cancelled' : 'Booking cancelled';
    const subtitle =
      appt && !cde
        ? 'Your appointment has been cancelled.'
        : cde
          ? 'Your booking has been cancelled.'
          : 'Your reservation has been cancelled.';
    return (
      <div className="w-full max-w-md text-center">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm space-y-4">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
            <svg className="h-6 w-6 text-slate-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>
          </div>
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          <p className="text-sm text-slate-500">{subtitle}</p>
          {cardHoldMessage && (
            <div
              className={
                cardHoldKept
                  ? 'rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-left'
                  : 'rounded-xl bg-blue-50 border border-blue-200 px-4 py-3 text-left'
              }
            >
              <p
                className={
                  cardHoldKept ? 'text-sm font-medium text-amber-800' : 'text-sm font-medium text-blue-800'
                }
              >
                {cardHoldKept ? 'No-show fee may apply' : 'Card hold released'}
              </p>
              <p className={cardHoldKept ? 'mt-1 text-sm text-amber-700' : 'mt-1 text-sm text-blue-700'}>
                {cardHoldMessage}
              </p>
            </div>
          )}
          {refundMessage && (
            <div className="rounded-xl bg-blue-50 border border-blue-200 px-4 py-3 text-left">
              <p className="text-sm font-medium text-blue-800">Deposit refund</p>
              <p className="mt-1 text-sm text-blue-700">{refundMessage}</p>
            </div>
          )}
          <Link href="/" className="mt-2 inline-block text-sm font-medium text-brand-600 hover:text-brand-700">Go home</Link>
        </div>
      </div>
    );
  }

  if (!details) return null;

  const dateStr = new Date(details.booking_date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  /*
    Every actor can now act, which closes P2-4's deliberate gap.

    P2-4 extracted this view and left a session actor reading the booking and
    not the buttons, because the buttons posted to `/api/confirm` with a token
    the portal does not hold. P2-2 supplied the cancel route and P2-3 the
    reschedule one, and `buildGuestModifyRequest` now sends each actor to the
    route that will answer it. So the gate is the BOOKING's state, not the
    reader's, and the `canAct` flag that expressed the difference is gone
    rather than left behind reading `true` everywhere.
  */
  const bookingIsLive =
    details.status === 'Confirmed' || details.status === 'Booked' || details.status === 'Pending';
  const canModify = bookingIsLive;
  const canCancel = bookingIsLive;
  const isAppointment = Boolean(details.is_appointment);
  const bookingModel: BookingModel = details.booking_model ?? 'table_reservation';
  const isCde = isCdeModel(bookingModel);
  /*
    The card-hold copy names the venue mid-sentence ("... {venue} may still
    charge a no-show fee of up to £15"), and the payload's `venue_name` can be
    undefined when the venue row does not read back. Typing this view against
    the shared DTO is what surfaced that: the local interface it used to carry
    declared the field as always present, so the money sentence could have
    rendered "undefined may still charge you" with nothing to say so.
  */
  const venueNameForCopy = details.venue_name ?? 'the venue';
  /*
    The sections added when P2-4 was completed, read defensively.

    This page fetches its payload at runtime on the token surface, so a client
    left open across a deploy can hold JS newer than the body it received. The
    cost of being wrong is a blank page for a guest trying to find out where
    their appointment is, and the cost of the guards is four lines.
  */
  const location = details.location ?? { type: 'venue' as const, address: null, map_url: null };
  const calendar = details.calendar ?? { google_url: null, ics: null };
  const notes = details.notes ?? [];
  const ticketLines = details.ticket_lines ?? [];
  const timeline = details.timeline ?? [];
  const isTableBooking = bookingModel === 'table_reservation';
  const isResourceBooking = bookingModel === 'resource_booking';
  const isClassBooking = bookingModel === 'class_session';

  const cdeSummary =
    details.event_name ??
    details.class_summary ??
    (details.resource_name
      ? details.booking_end_time
        ? `${details.resource_name} · until ${details.booking_end_time}`
        : details.resource_name
      : null);

  const guestSelfRescheduleEnabled = Boolean(
    details.feature_flags?.resolved?.guest_self_reschedule,
  );
  // Resource bookings move to another slot for the same resource; class bookings
  // move to another future instance of the same class type. Both reuse the
  // appointment-style `guest_self_reschedule` gate (the only modify gate the
  // platform encodes). Events stay cancel+rebook (see copy below).
  const canGuestModifyResource =
    isResourceBooking && guestSelfRescheduleEnabled && Boolean(details.resource_id);
  const canGuestModifyClass =
    isClassBooking &&
    guestSelfRescheduleEnabled &&
    Boolean(details.class_instance_id) &&
    Boolean(details.class_type_id);
  const showGuestModify =
    canModify &&
    (isTableBooking ||
      (isAppointment && guestSelfRescheduleEnabled) ||
      canGuestModifyResource ||
      canGuestModifyClass);
  /*
    The venue has switched self-reschedule off AND this booking is a model that
    would otherwise offer one. Table reservations are excluded because their
    modify has never been behind this flag, and events because they are
    cancel-and-rebook by nature and already explain themselves below.
  */
  const rescheduleTurnedOff =
    canModify &&
    !guestSelfRescheduleEnabled &&
    (isAppointment || isResourceBooking || isClassBooking);
  const modifyButtonLabel = isAppointment
    ? 'Change appointment'
    : isClassBooking
      ? 'Change session'
      : isResourceBooking
        ? 'Change slot'
        : 'Modify booking';
  const cancelButtonLabel = isCde ? 'Cancel booking' : isAppointment ? 'Cancel appointment' : 'Cancel reservation';
  const keepButtonLabel = isCde ? 'Keep booking' : isAppointment ? 'Keep appointment' : 'Keep booking';

  // Model-aware noun + policy-aware refund copy (use "booking" for CDE, not "reservation").
  const bookingNoun = isCde ? 'booking' : isAppointment ? 'appointment' : 'reservation';
  /*
    `refundPolicyCopy` and `cardHoldLateCancelWarning` used to be derived here
    and shown inside the cancel panel. Both are gone: the first stated the
    venue's rule ("full refund if cancelled 24+ hours before") and left the
    guest to work out which side of it they were on, and the second said the
    deadline had passed, which the consequence list below now says once rather
    than twice. What replaced them states the outcome for this booking.
  */

  /*
    What cancelling actually does to THIS booking (P2-2, closes part of G13).

    The panel this replaced stated the venue's refund POLICY: "full refund if
    cancelled 24+ hours before". That is the rule, not the answer. A guest
    deciding whether to cancel needs to know which side of the deadline they
    are on right now, because the four outcomes below differ on exactly that,
    and two of them are about money they will not get back.

    Each line is included only when it applies, so a booking with no deposit,
    no card hold and no credit gets one sentence rather than four hedged ones.
  */
  const deadlineMs = details.cancellation_deadline
    ? Date.parse(details.cancellation_deadline)
    : Number.NaN;
  const pastDeadline = Number.isFinite(deadlineMs) && Date.now() > deadlineMs;
  const deadlineLabel = Number.isFinite(deadlineMs)
    ? new Date(deadlineMs).toLocaleString('en-GB', {
        weekday: 'short',
        day: 'numeric',
        month: 'long',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  const cancelConsequences: string[] = [];
  if (deadlineLabel) {
    cancelConsequences.push(
      pastDeadline
        ? `The free cancellation deadline passed on ${deadlineLabel}.`
        : `You can cancel free of charge until ${deadlineLabel}.`,
    );
  }
  if (details.deposit_paid && details.deposit_amount_pence != null) {
    const amount = `£${(details.deposit_amount_pence / 100).toFixed(2)}`;
    cancelConsequences.push(
      pastDeadline
        ? `Your ${amount} deposit will not be refunded.`
        : `Your ${amount} deposit will be refunded.`,
    );
  }
  if (details.card_hold?.state === 'held') {
    const fee = formatCardHoldFeePence(details.card_hold.fee_pence);
    cancelConsequences.push(
      pastDeadline
        ? `${venueNameForCopy} may charge a no-show fee of up to ${fee}.`
        : `No no-show fee will be charged, and the hold on your card is released.`,
    );
  }
  if (isClassBooking && details.paid_with_credit) {
    cancelConsequences.push(
      pastDeadline
        ? 'Your class credit will not be returned.'
        : 'Your class credit will be returned to your account.',
    );
  }
  if (cancelConsequences.length === 0) {
    cancelConsequences.push(`Your ${bookingNoun} will be cancelled. This cannot be undone.`);
  }

  return (
    /*
      `max-w-lg` is right for the standalone page, where the card IS the page.
      Inside the portal it sits in a 1024px column and reads as unfinished, so
      the embedded chrome takes the wider bound.
    */
    <div className={standalone ? 'w-full min-w-0 max-w-lg' : 'w-full min-w-0 max-w-2xl'}>
      {standalone && (
        <div className="mb-6">
          <img src="/Logo.png" alt="ResNeo" className="h-8 w-auto" />
        </div>
      )}

      <div className="min-w-0 max-w-full rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="bg-gradient-to-r from-brand-600 to-brand-700 px-6 py-5">
          <h2 className="text-lg font-semibold text-white">{details.venue_name}</h2>
          {details.venue_address && <p className="mt-0.5 text-sm text-brand-100">{details.venue_address}</p>}
        </div>

        <div className="min-w-0 space-y-4 p-4 sm:p-6">
          {modifySuccess && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 font-medium">
              {isAppointment ? 'Your appointment has been updated.' : 'Your booking has been updated.'}
            </div>
          )}

          {isCde ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2.5">
                <p className="text-xs font-medium text-slate-500">{bookingModelShortLabel(bookingModel)} booking</p>
                {cdeSummary && <p className="mt-1 text-sm font-semibold text-slate-800 leading-snug">{cdeSummary}</p>}
              </div>
              <div className="grid min-w-0 grid-cols-1 gap-3 min-[420px]:grid-cols-2">
                <DetailTile label="Date" value={dateStr} />
                <DetailTile label="Time" value={details.booking_time.slice(0, 5)} />
                <DetailTile label="Guests" value={`${details.party_size}`} />
                <DetailTile label="Status" value={details.status} />
              </div>
            </div>
          ) : isAppointment ? (
            <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
              <DetailTile label="Service" value={details.appointment_service_name ?? '-'} />
              <DetailTile label="Staff" value={details.practitioner_name ?? '-'} />
              <DetailTile label="Date" value={dateStr} />
              <DetailTile label="Time" value={details.booking_time.slice(0, 5)} />
              {details.party_size > 1 && <DetailTile label="People" value={`${details.party_size}`} />}
              <DetailTile label="Status" value={details.status} />
            </div>
          ) : (
            <div className="grid min-w-0 grid-cols-1 gap-3 min-[420px]:grid-cols-2">
              <DetailTile label="Date" value={dateStr} />
              <DetailTile label="Time" value={details.booking_time.slice(0, 5)} />
              <DetailTile label="Guests" value={`${details.party_size}`} />
              <DetailTile label="Status" value={details.status} />
            </div>
          )}

          {/*
            Who cancelled (Q-22). A guest opening a cancelled booking is living
            with a refund outcome, and "you cancelled this" and "the venue
            cancelled this" are not the same news.
          */}
          {details.cancelled_by && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
              <p className="font-medium text-slate-800">
                {details.cancelled_by === 'venue'
                  ? 'This booking was cancelled by the venue.'
                  : 'You cancelled this booking.'}
              </p>
              {details.cancelled_by === 'venue' && (
                <p className="mt-1 text-slate-600">
                  Contact the venue if you were expecting this to go ahead.
                </p>
              )}
            </div>
          )}

          {/* Where. Not always the venue: an appointment can be at the
              customer's address or online, which is what `location_type` and
              the four client-address columns exist to say. */}
          {/*
            For a booking at the venue the address is already in the header, so
            only the directions link is new; repeating the address under a
            "Where" label would be the same line twice on one card. The other
            two types genuinely say something else, and get the full block.
          */}
          {location.type === 'venue'
            ? location.map_url && (
                <a
                  href={location.map_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-6 items-center text-sm font-medium text-brand-700 underline underline-offset-2"
                >
                  Get directions
                </a>
              )
            : (
                <div className="rounded-xl border border-slate-100 bg-slate-50/80 px-4 py-3 text-sm">
                  <p className="text-xs font-medium text-slate-500">
                    {location.type === 'client_address' ? 'Where (your address)' : 'Where'}
                  </p>
                  <p className="mt-1 font-medium text-slate-800">
                    {location.type === 'online'
                      ? 'Online. The venue will send you a link.'
                      : (location.address ?? 'The venue will confirm the address with you.')}
                  </p>
                  {location.map_url && (
                    <a
                      href={location.map_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1.5 inline-flex min-h-6 items-center text-sm font-medium text-brand-700 underline underline-offset-2"
                    >
                      Get directions
                    </a>
                  )}
                </div>
              )}

          {/* G8a: written by venues and, until this shipped, read by nothing. */}
          {details.pre_appointment_instructions && (
            <div className="rounded-xl border border-brand-200 bg-brand-50/50 px-4 py-3 text-sm">
              <p className="font-semibold text-brand-900">Before your visit</p>
              <p className="mt-1 whitespace-pre-wrap leading-relaxed text-slate-700">
                {details.pre_appointment_instructions}
              </p>
            </div>
          )}

          {ticketLines.length > 0 && (
            <div className="rounded-xl border border-slate-100 bg-slate-50/80 px-4 py-3 text-sm">
              <p className="text-xs font-medium text-slate-500">Tickets</p>
              <ul className="mt-1.5 space-y-1">
                {ticketLines.map((line, i) => (
                  <li key={`${line.label}-${i}`} className="flex justify-between gap-3">
                    <span className="text-slate-800">
                      {line.quantity} x {line.label}
                    </span>
                    {line.unit_price_pence > 0 && (
                      <span className="text-slate-600">
                        &pound;{((line.unit_price_pence * line.quantity) / 100).toFixed(2)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {notes.length > 0 && (
            <div className="rounded-xl border border-slate-100 bg-slate-50/80 px-4 py-3 text-sm">
              <p className="text-xs font-medium text-slate-500">What you told the venue</p>
              <dl className="mt-1.5 space-y-1.5">
                {notes.map((note) => (
                  <div key={note.label}>
                    <dt className="text-xs text-slate-500">{note.label}</dt>
                    <dd className="whitespace-pre-wrap text-slate-800">{note.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {details.compliance_forms && details.compliance_forms.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm">
              <p className="font-semibold text-amber-900">Forms to complete before your visit</p>
              <ul className="mt-2 space-y-1.5">
                {details.compliance_forms.map((f) => (
                  <li key={f.url}>
                    <a
                      href={f.url}
                      className="font-medium text-brand-700 underline hover:text-brand-800"
                    >
                      {f.name} →
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {details.deposit_paid && details.deposit_amount_pence != null && (
            <div className="rounded-xl bg-emerald-50 px-4 py-3 text-sm">
              <span className="font-medium text-emerald-800">Deposit paid:</span>{' '}
              <span className="text-emerald-700">&pound;{(details.deposit_amount_pence / 100).toFixed(2)}</span>
            </div>
          )}

          {/* Card-hold deposits (§10.1). `released` renders nothing special
              (the booking is likely cancelled by then). */}
          {details.card_hold?.state === 'awaiting_card' && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm space-y-2.5">
              <p className="text-amber-900">
                Add your card details to secure this booking. No payment is taken.
              </p>
              {details.card_hold.payment_link && (
                <a
                  href={details.card_hold.payment_link}
                  className="block w-full rounded-lg bg-brand-600 px-4 py-2.5 text-center text-sm font-medium text-white hover:bg-brand-700"
                >
                  Add card details
                </a>
              )}
            </div>
          )}
          {details.card_hold?.state === 'held' && (
            <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm">
              <p className="text-blue-800">
                {guestCardHoldHeldLine(
                  venueNameForCopy,
                  details.card_hold.fee_pence,
                  details.cancellation_deadline,
                )}
              </p>
            </div>
          )}
          {details.card_hold?.state === 'charged' && details.card_hold.charged_pence != null && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
              <p className="text-slate-700">
                {`A no-show fee of ${formatCardHoldFeePence(details.card_hold.charged_pence)} was charged for this booking${
                  details.card_hold.charged_at
                    ? ` on ${new Date(details.card_hold.charged_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`
                    : ''
                }.`}
              </p>
            </div>
          )}

          {/*
            P2-3: when a venue turns self-reschedule off, say so.

            Hiding the button on its own leaves a customer looking for a
            control that is not there, deciding the page is broken, and ringing
            the venue anyway. This is the same product setting the emailed link
            obeys, not a rollout gate.
          */}
          {rescheduleTurnedOff && !showCancelConfirm && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-1.5">
              <p className="text-sm font-medium text-slate-800">Need a different time?</p>
              <p className="text-xs text-slate-600">
                {venueNameForCopy} does not offer changes online. Please contact them
                {details.venue_phone ? (
                  <>
                    {' '}on{' '}
                    <a href={`tel:${details.venue_phone}`} className="font-semibold text-brand-700 underline">
                      {details.venue_phone}
                    </a>
                  </>
                ) : null}
                {' '}to move this booking. You can still cancel it below.
              </p>
            </div>
          )}

          {showGuestModify && !showModify && !showCancelConfirm && (
            <button
              type="button"
              onClick={() => { setShowModify(true); setShowCancelConfirm(false); }}
              className="w-full rounded-xl border border-brand-200 bg-white px-4 py-3 text-sm font-medium text-brand-600 hover:bg-brand-50"
            >
              {modifyButtonLabel}
            </button>
          )}

          {/*
            P2-3: a course is several booking rows sharing a group id, and this
            page changes one of them. Placed ABOVE the picker rather than in a
            confirmation afterwards, because by then the guest has already
            moved the session they did not mean to move.
          */}
          {showGuestModify && showModify && details.part_of_course && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
              This is one session of a course. Changing it here moves only this session;
              the rest keep their current times. To move the whole course, contact the venue.
            </div>
          )}

          {showGuestModify && showModify && isAppointment && details.practitioner_id && details.appointment_service_id && (
            details.venue_public ? (
              <div className="rounded-xl border border-brand-200 bg-brand-50/30 p-4">
                <AppointmentBookingFlow
                  venue={details.venue_public}
                  bookingAudience="public"
                  initialDate={details.booking_date}
                  initialTime={details.booking_time}
                  preselectedPractitionerId={details.practitioner_id}
                  onBookingCreated={handleModifySaved}
                  onBookingModified={handleModifyRefresh}
                  editBooking={{
                    id: bookingId,
                    booking_date: details.booking_date,
                    booking_time: details.booking_time,
                    party_size: details.party_size,
                    practitioner_id: details.practitioner_id,
                    service_id: details.appointment_service_id,
                    guestActor: actor,
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowModify(false)}
                  className="mt-3 w-full rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
                >
                  Back
                </button>
              </div>
            ) : (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                Could not load the booking form. Please contact the venue to change this appointment.
              </div>
            )
          )}

          {canModify && showModify && isTableBooking && (
            <ModifyTableBookingSection
              bookingId={bookingId}
              venueId={details.venue_id}
              venuePhone={details.venue_phone}
              currentDate={details.booking_date}
              currentTime={details.booking_time}
              currentPartySize={details.party_size}
              actor={actor}
              onSaved={handleModifySaved}
              onCancel={() => setShowModify(false)}
            />
          )}

          {showGuestModify && showModify && canGuestModifyResource && details.resource_id && (
            <ModifyResourceBookingSection
              bookingId={bookingId}
              venueId={details.venue_id}
              resourceId={details.resource_id}
              currentDate={details.booking_date}
              currentTime={details.booking_time}
              currentEndTime={details.booking_end_time ?? null}
              actor={actor}
              onSaved={handleModifySaved}
              onCancel={() => setShowModify(false)}
            />
          )}

          {showGuestModify &&
            showModify &&
            canGuestModifyClass &&
            details.class_type_id &&
            details.class_instance_id && (
              <ModifyClassBookingSection
                bookingId={bookingId}
                venueId={details.venue_id}
                classTypeId={details.class_type_id}
                currentInstanceId={details.class_instance_id}
                className={details.class_type_name ?? null}
                actor={actor}
                onSaved={handleModifySaved}
                onCancel={() => setShowModify(false)}
              />
            )}

          {/* Events: no online slot-move (ticketed/multi-tier moves are out of v1).
              Show how to change instead of a (non-functional) modify button. */}
          {canModify && bookingModel === 'event_ticket' && !showCancelConfirm && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-1.5">
              <p className="text-sm font-medium text-slate-800">Need to change this event booking?</p>
              <p className="text-xs text-slate-600">
                Event tickets can&rsquo;t be moved to another date online. To change your
                booking, cancel it below (if the cancellation policy allows a refund) and
                book the new date, or contact the venue
                {details.venue_phone ? (
                  <>
                    {' '}at{' '}
                    <a href={`tel:${details.venue_phone}`} className="font-semibold text-brand-700 underline">
                      {details.venue_phone}
                    </a>
                  </>
                ) : null}
                .
              </p>
            </div>
          )}

          {canCancel && !showCancelConfirm && !showModify && (
            <button
              type="button"
              onClick={() => { setShowCancelConfirm(true); setShowModify(false); }}
              className="w-full rounded-xl border border-red-200 bg-white px-4 py-3 text-sm font-medium text-red-600 hover:bg-red-50"
            >
              {cancelButtonLabel}
            </button>
          )}

          {/*
            `ConfirmDialog` with its `body` slot (P0-16 added it for this), not
            the hand-rolled red panel this replaced. That panel stated the
            venue's refund POLICY and left the guest to work out which side of
            the deadline they were on; the list below states the OUTCOME for
            this booking, which is what they are actually deciding about.
          */}
          <ConfirmDialog
            open={canCancel && showCancelConfirm}
            onOpenChange={(next) => {
              setShowCancelConfirm(next);
              if (!next) setError(null);
            }}
            title={cancelButtonLabel}
            message={`This cannot be undone. Here is what happens to your ${bookingNoun}:`}
            body={
              <div className="space-y-2 text-sm">
                <ul className="list-disc space-y-1.5 pl-5 text-slate-700">
                  {cancelConsequences.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                {error && <p className="text-sm font-medium text-red-700">{error}</p>}
              </div>
            }
            confirmLabel={cancelling ? 'Cancelling…' : 'Yes, cancel'}
            cancelLabel={keepButtonLabel}
            onConfirm={() => void handleCancel()}
          />
          {/*
            Add to calendar. Both links are built server-side, because getting
            them right needs the venue's timezone and the browser does not have
            it: a booking's time is the venue's wall clock, so 14:00 in London
            belongs in the guest's calendar at 13:00 UTC during BST.
          */}
          {/*
            `bookingIsLive` as well as `!cancelled`: the latter is only set
            after a cancel performed in THIS session, so a booking that was
            already cancelled when the page loaded still offered to put itself
            in the guest's calendar.
          */}
          {(calendar.google_url || calendar.ics) && bookingIsLive && !cancelled && (
            <div className="flex flex-wrap gap-3 border-t border-slate-100 pt-4 text-sm">
              {calendar.google_url && (
                <a
                  href={calendar.google_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-10 items-center rounded-lg border border-slate-200 bg-white px-3 py-2 font-medium text-slate-700 hover:bg-slate-50"
                >
                  Add to Google Calendar
                </a>
              )}
              {calendar.ics && (
                <button
                  type="button"
                  onClick={() => downloadIcs(calendar.ics!, details.booking_date)}
                  className="inline-flex min-h-10 items-center rounded-lg border border-slate-200 bg-white px-3 py-2 font-medium text-slate-700 hover:bg-slate-50"
                >
                  Download for other calendars
                </button>
              )}
            </div>
          )}

          {(details.venue_phone || details.venue_email) && (
            <div className="border-t border-slate-100 pt-4 text-sm">
              <p className="text-xs font-medium text-slate-500">Contact the venue</p>
              <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                {details.venue_phone && (
                  <a
                    href={`tel:${details.venue_phone}`}
                    className="inline-flex min-h-6 items-center font-medium text-brand-700 underline underline-offset-2"
                  >
                    {details.venue_phone}
                  </a>
                )}
                {details.venue_email && (
                  <a
                    href={`mailto:${details.venue_email}`}
                    className="inline-flex min-h-6 items-center font-medium text-brand-700 underline underline-offset-2"
                  >
                    {details.venue_email}
                  </a>
                )}
              </p>
            </div>
          )}

          {timeline.length > 0 && (
            <div className="border-t border-slate-100 pt-4">
              <p className="text-xs font-medium text-slate-500">History</p>
              <ul className="mt-1.5 space-y-1 text-sm text-slate-600">
                {timeline.map((entry) => (
                  <li key={`${entry.label}-${entry.at}`}>
                    {entry.label} ·{' '}
                    {new Date(entry.at).toLocaleDateString('en-GB', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    })}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {standalone && (
        <p className="mt-4 text-center text-xs text-slate-400">
          <Link href="/" className="hover:text-brand-600">Powered by ResNeo</Link>
        </p>
      )}
    </div>
  );
}

function ModifyTableBookingSection({
  bookingId,
  venueId,
  venuePhone,
  currentDate,
  currentTime,
  currentPartySize,
  actor,
  onSaved,
  onCancel,
}: {
  bookingId: string;
  venueId: string;
  venuePhone: string | null;
  currentDate: string;
  currentTime: string;
  currentPartySize: number;
  actor: GuestBookingDetailActor;
  onSaved: () => void;
  onCancel: () => void;
}) {
  /*
    Register Q-04: these three controls had visible labels that were not
    ATTACHED to them, so a screen reader announced "edit text, blank" three
    times over. `useId` rather than fixed ids because this section is a
    component, and two of it on one page would produce duplicate ids, which is
    the same bug wearing a different hat.
  */
  const fieldId = useId();
  const [date, setDate] = useState(currentDate);
  const [partySize, setPartySize] = useState(currentPartySize);
  const [selectedTime, setSelectedTime] = useState(currentTime.slice(0, 5));
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [largePartyMessage, setLargePartyMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const hasChanges =
    date !== currentDate ||
    selectedTime !== currentTime.slice(0, 5) ||
    partySize !== currentPartySize;

  useEffect(() => {
    if (!date || partySize < 1) {
      setSlots([]);
      setLargePartyMessage(null);
      return;
    }
    setLoadingSlots(true);
    setError(null);
    setLargePartyMessage(null);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (abortRef.current) abortRef.current.abort();

    debounceRef.current = setTimeout(() => {
      const controller = new AbortController();
      abortRef.current = controller;

      (async () => {
        try {
          const url = `/api/booking/availability?venue_id=${encodeURIComponent(venueId)}&date=${encodeURIComponent(date)}&party_size=${partySize}`;
          const res = await fetch(url, { signal: controller.signal });
          if (controller.signal.aborted) return;
          if (!res.ok) throw new Error('Failed to load times');
          const data = await res.json();

          if (data.large_party_redirect) {
            if (!controller.signal.aborted) {
              setSlots([]);
              setLargePartyMessage(data.large_party_message ?? 'Please call the restaurant to book for larger parties.');
            }
            return;
          }

          const rawSlots: Slot[] = (data.slots ?? [])
            .map((s: Record<string, unknown>) => ({
              key: (s.key as string) ?? (s.start_time as string) ?? '',
              label: (s.label as string) ?? (s.start_time as string)?.slice(0, 5) ?? '',
              start_time: (s.start_time as string) ?? '',
              available_covers: (s.available_covers as number) ?? 0,
            }))
            .filter((s: Slot) => s.start_time);

          if (!controller.signal.aborted) {
            setSlots(rawSlots);
            const currentTimeShort = selectedTime.slice(0, 5);
            const match = rawSlots.find((s) => s.start_time.slice(0, 5) === currentTimeShort);
            if (!match && rawSlots.length > 0) {
              setSelectedTime(rawSlots[0].start_time.slice(0, 5));
            }
          }
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          if (!controller.signal.aborted) setSlots([]);
        } finally {
          if (!controller.signal.aborted) setLoadingSlots(false);
        }
      })();
    }, 250);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, partySize, venueId]);

  const handleSave = useCallback(async () => {
    if (!hasChanges) {
      onCancel();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const changes: GuestModifyChanges = {
        booking_date: date,
        booking_time: selectedTime,
        party_size: partySize,
      };
      // Where this goes depends on who is asking: the emailed link posts to
      // `/api/confirm` with its token, a signed-in customer to their own
      // account route. `buildGuestModifyRequest` owns that decision for all
      // four modify surfaces so they cannot drift apart.
      const request = buildGuestModifyRequest(actor, bookingId, changes);
      if (!request) {
        setError('This booking cannot be changed from here.');
        return;
      }
      const base = typeof window !== 'undefined' ? window.location.origin : '';
      const res = await fetch(`${base}${request.url}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request.body),
      });

      if (!res.ok) {
        setError(await readGuestModifyError(res));
        return;
      }

      onSaved();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [bookingId, actor, date, selectedTime, partySize, hasChanges, onCancel, onSaved]);

  return (
    <div className="rounded-xl border border-brand-200 bg-brand-50/30 p-4 space-y-3">
      <p className="text-sm font-semibold text-slate-800">Modify your booking</p>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={`${fieldId}-date`} className="mb-1 block text-xs font-medium text-slate-500">Date</label>
          <input
            id={`${fieldId}-date`}
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
          />
        </div>
        <div>
          <label htmlFor={`${fieldId}-party`} className="mb-1 block text-xs font-medium text-slate-500">Party size</label>
          <NumericInput
            id={`${fieldId}-party`}
            min={1}
            max={50}
            value={partySize}
            onChange={setPartySize}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
          />
        </div>
      </div>

      <div>
        <label htmlFor={`${fieldId}-time`} className="mb-1 block text-xs font-medium text-slate-500">Time</label>
        {loadingSlots ? (
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
            <span className="text-xs text-slate-500">Loading available times...</span>
          </div>
        ) : largePartyMessage ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-700">
            <p className="font-medium">{largePartyMessage}</p>
            {venuePhone && (
              <p className="mt-1">
                Call us at{' '}
                <a href={`tel:${venuePhone}`} className="font-semibold text-amber-800 underline">
                  {venuePhone}
                </a>
              </p>
            )}
          </div>
        ) : slots.length === 0 ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            No available times for this date and party size.
          </div>
        ) : (
          <select
            id={`${fieldId}-time`}
            value={selectedTime}
            onChange={(e) => setSelectedTime(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
          >
            {slots.map((slot) => (
              <option key={slot.key} value={slot.start_time.slice(0, 5)}>
                {slot.label} ({slot.available_covers} cover{slot.available_covers !== 1 ? 's' : ''} available)
              </option>
            ))}
          </select>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
          {error}
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving || !hasChanges || !!largePartyMessage || (slots.length === 0 && !loadingSlots)}
          className="flex-1 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save changes'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="flex-1 rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
        >
          Back
        </button>
      </div>
    </div>
  );
}

function deriveResourceDurationMinutes(currentTime: string, currentEndTime: string | null): number {
  const start = currentTime.slice(0, 5);
  if (currentEndTime && currentEndTime.length >= 5) {
    const mins = minutesBetweenStartAndEndHM(start, currentEndTime.slice(0, 5));
    if (mins >= 5) return mins;
  }
  return 60;
}

function ModifyResourceBookingSection({
  bookingId,
  venueId,
  resourceId,
  currentDate,
  currentTime,
  currentEndTime,
  actor,
  onSaved,
  onCancel,
}: {
  bookingId: string;
  venueId: string;
  resourceId: string;
  currentDate: string;
  currentTime: string;
  currentEndTime: string | null;
  actor: GuestBookingDetailActor;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const initialDuration = deriveResourceDurationMinutes(currentTime, currentEndTime);
  const [date, setDate] = useState(currentDate);
  const [time, setTime] = useState(currentTime.slice(0, 5));
  const [duration, setDuration] = useState(initialDuration);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasChanges =
    date !== currentDate ||
    time !== currentTime.slice(0, 5) ||
    duration !== initialDuration;

  const handleSave = useCallback(async () => {
    if (!hasChanges) {
      onCancel();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const changes: GuestModifyChanges = {
        booking_date: date,
        booking_time: time,
        duration_minutes: duration,
      };
      // Where this goes depends on who is asking: the emailed link posts to
      // `/api/confirm` with its token, a signed-in customer to their own
      // account route. `buildGuestModifyRequest` owns that decision for all
      // four modify surfaces so they cannot drift apart.
      const request = buildGuestModifyRequest(actor, bookingId, changes);
      if (!request) {
        setError('This booking cannot be changed from here.');
        return;
      }
      const base = typeof window !== 'undefined' ? window.location.origin : '';
      const res = await fetch(`${base}${request.url}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request.body),
      });
      if (!res.ok) {
        setError(await readGuestModifyError(res));
        return;
      }
      onSaved();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [bookingId, actor, date, time, duration, hasChanges, onCancel, onSaved]);

  return (
    <div className="rounded-xl border border-brand-200 bg-brand-50/30 p-4 space-y-3">
      <p className="text-sm font-semibold text-slate-800">Choose a new slot</p>

      <GuestResourceModifySlotPicker
        venueId={venueId}
        bookingId={bookingId}
        resourceId={resourceId}
        initialBookingDate={currentDate}
        initialBookingTime={currentTime.slice(0, 5)}
        initialDurationMinutes={initialDuration}
        bookingDate={date}
        bookingTime={time}
        durationMinutes={duration}
        onBookingDateChange={setDate}
        onBookingTimeChange={setTime}
        onDurationChange={setDuration}
        disabled={saving}
      />

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving || !hasChanges || !time}
          className="flex-1 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save changes'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="flex-1 rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
        >
          Back
        </button>
      </div>
    </div>
  );
}

function ModifyClassBookingSection({
  bookingId,
  venueId,
  classTypeId,
  currentInstanceId,
  className,
  actor,
  onSaved,
  onCancel,
}: {
  bookingId: string;
  venueId: string;
  classTypeId: string;
  currentInstanceId: string;
  className: string | null;
  actor: GuestBookingDetailActor;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState<GuestClassInstanceOption | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = useCallback(async () => {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      const changes: GuestModifyChanges = {
        target_class_instance_id: selected.instance_id,
      };
      // Where this goes depends on who is asking: the emailed link posts to
      // `/api/confirm` with its token, a signed-in customer to their own
      // account route. `buildGuestModifyRequest` owns that decision for all
      // four modify surfaces so they cannot drift apart.
      const request = buildGuestModifyRequest(actor, bookingId, changes);
      if (!request) {
        setError('This booking cannot be changed from here.');
        return;
      }
      const base = typeof window !== 'undefined' ? window.location.origin : '';
      const res = await fetch(`${base}${request.url}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request.body),
      });
      if (!res.ok) {
        setError(await readGuestModifyError(res));
        return;
      }
      onSaved();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [bookingId, actor, selected, onSaved]);

  return (
    <div className="rounded-xl border border-brand-200 bg-brand-50/30 p-4 space-y-3">
      <p className="text-sm font-semibold text-slate-800">
        Move {className ? `your ${className} booking` : 'your class booking'} to another session
      </p>

      <GuestClassModifyInstancePicker
        venueId={venueId}
        classTypeId={classTypeId}
        currentInstanceId={currentInstanceId}
        selectedInstanceId={selected?.instance_id ?? null}
        onSelect={setSelected}
        disabled={saving}
      />

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving || !selected}
          className="flex-1 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Move booking'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="flex-1 rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
        >
          Back
        </button>
      </div>
    </div>
  );
}

function DetailTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/50 px-3 py-2.5">
      <p className="text-xs font-medium text-slate-400">{label}</p>
      <p
        data-testid={`detail-${label.toLowerCase().replace(/\s+/g, '-')}`}
        className="mt-0.5 text-sm font-semibold text-slate-800"
      >
        {value}
      </p>
    </div>
  );
}
