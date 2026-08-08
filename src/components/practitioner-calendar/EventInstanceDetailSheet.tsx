'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { ScheduleBlockDTO } from '@/types/schedule-blocks';
import type { LinkActionLevel } from '@/lib/linked-accounts/types';
import { Sheet } from '@/components/ui/primitives/Sheet';
import { Button } from '@/components/ui/primitives/Button';
import { RegistryBookingAccordionList } from '@/app/dashboard/bookings/RegistryBookingAccordionList';

interface TicketTypeRow {
  id?: string;
  name: string;
  price_pence: number;
  capacity?: number | null;
}

interface ExperienceEventPayload {
  id: string;
  name: string;
  description?: string | null;
  event_date: string;
  start_time: string;
  end_time: string;
  capacity: number;
  is_active?: boolean;
  calendar_id?: string | null;
  ticket_types?: TicketTypeRow[] | null;
}

export interface LinkedEventDetailContext {
  ownerVenueId: string;
  ownerVenueName: string;
  ownerVenueTimezone: string;
  ownerCurrency: string;
  linkedAct: LinkActionLevel;
  linkedPii: boolean;
}

export type EventInstanceSheetSelection = {
  eventId: string;
  block: ScheduleBlockDTO;
  linked?: LinkedEventDetailContext;
};

interface Props {
  selection: EventInstanceSheetSelection | null;
  onClose: () => void;
  venueId: string;
  currency?: string;
  venueTimezone?: string;
  onUpdated?: () => void;
  /** When set, staff can start a pre-filled event booking from this sheet. */
  onBookNow?: () => void;
  canBook?: boolean;
}

export function EventInstanceDetailSheet({
  selection,
  onClose,
  venueId,
  currency = 'GBP',
  venueTimezone = 'Europe/London',
  onUpdated,
  onBookNow,
  canBook = false,
}: Props) {
  const open = selection !== null;
  const linked = selection?.linked ?? null;

  const [eventRow, setEventRow] = useState<ExperienceEventPayload | null>(null);
  const [linkedCurrencyLoaded, setLinkedCurrencyLoaded] = useState<string | null>(null);
  const [bookedGuests, setBookedGuests] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveVenueId = linked?.ownerVenueId ?? venueId;
  const effectiveCurrency = linkedCurrencyLoaded ?? linked?.ownerCurrency ?? currency;
  const effectiveTimezone = linked?.ownerVenueTimezone ?? venueTimezone;

  const eventId = selection?.eventId ?? null;

  const loadEvent = useCallback(async () => {
    if (!eventId) return;
    setLoading(true);
    setError(null);
    try {
      if (linked) {
        const params = new URLSearchParams({
          eventId,
          ownerVenueId: linked.ownerVenueId,
        });
        const evRes = await fetch(`/api/venue/linked-calendar/event?${params}`);
        if (!evRes.ok) {
          const j = await evRes.json().catch(() => ({}));
          throw new Error((j as { error?: string }).error ?? 'Could not load event');
        }
        const payload = (await evRes.json()) as {
          event?: ExperienceEventPayload;
          currency?: string;
        };
        setEventRow(payload.event ?? null);
        setLinkedCurrencyLoaded(
          typeof payload.currency === 'string' && payload.currency.trim() !== ''
            ? payload.currency.trim()
            : 'GBP',
        );
        return;
      }

      const evRes = await fetch(`/api/venue/experience-events/${eventId}`);
      if (!evRes.ok) {
        const j = await evRes.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error ?? 'Could not load event');
      }
      const evJson = (await evRes.json()) as ExperienceEventPayload;
      setEventRow(evJson);
    } catch (e) {
      setEventRow(null);
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }, [eventId, linked]);

  useEffect(() => {
    if (!selection || !eventId) {
      setEventRow(null);
      setLinkedCurrencyLoaded(null);
      setBookedGuests(null);
      setError(null);
      return;
    }
    void loadEvent();
  }, [selection, eventId, loadEvent]);

  if (!open || !selection) return null;

  const block = selection.block;
  const title = eventRow?.name ?? block.title;
  const dateStr = eventRow?.event_date ?? block.date;
  const startStr = eventRow?.start_time ? String(eventRow.start_time).slice(0, 5) : block.start_time.slice(0, 5);
  const endStr = eventRow?.end_time ? String(eventRow.end_time).slice(0, 5) : block.end_time.slice(0, 5);
  const cap = eventRow?.capacity ?? block.event_capacity;
  const bookedDisplay = bookedGuests ?? block.event_party_total ?? 0;
  const arrivedCount = block.event_arrived_count ?? 0;
  const bookingCount = block.event_booking_count ?? 0;

  const linkedReadOnly = linked != null && linked.linkedAct === 'none';
  const spotsRemaining =
    cap != null ? Math.max(0, cap - bookedDisplay) : null;
  const showBookNow =
    canBook &&
    onBookNow != null &&
    !linkedReadOnly &&
    eventRow?.is_active !== false &&
    (spotsRemaining == null || spotsRemaining > 0);

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={title}
      hideHeader
      showClose={false}
      side="right"
      contentClassName="flex max-h-[90dvh] flex-col overflow-hidden p-0 lg:max-h-none lg:max-w-2xl"
    >
      <aside className="flex min-h-0 flex-1 flex-col overflow-y-auto" aria-labelledby="event-detail-title">
        <div className="sticky top-0 z-[1] flex items-start justify-between gap-3 border-b border-slate-100 bg-white px-4 py-3">
          <div className="min-w-0">
            {linked ? (
              <p className="text-[11px] font-semibold uppercase tracking-wide text-sky-800">
                Linked · {linked.ownerVenueName}
              </p>
            ) : null}
            <h2 id="event-detail-title" className="text-lg font-semibold text-slate-900">
              {title}
            </h2>
            <p className="mt-0.5 text-sm text-slate-600">
              {dateStr} · {startStr} – {endStr}
            </p>
            {linkedReadOnly ? (
              <p className="mt-1 text-xs text-slate-500">View only. This link does not allow changes.</p>
            ) : linked && linked.linkedAct === 'edit_existing' ? (
              <p className="mt-1 text-xs text-slate-500">Limited edit. Cancel and rebook are not available on this link.</p>
            ) : null}
            {eventRow?.is_active === false ? (
              <span className="mt-2 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                Inactive
              </span>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            aria-label="Close"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-4 px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2 text-sm">
            <span className="text-slate-600">
              <span className="font-semibold text-slate-900">{bookedDisplay}</span>
              {cap != null ? (
                <>
                  {' '}
                  / {cap} spots
                </>
              ) : (
                ' guests booked'
              )}
              {bookingCount > 0 ? (
                <>
                  {' '}
                  ·{' '}
                  <span className="font-semibold text-amber-900">{arrivedCount}</span>
                  {' '}
                  / {bookingCount} arrived
                </>
              ) : null}
            </span>
            {!linked ? (
              <div className="flex flex-wrap items-center gap-3">
                <Link
                  href={`/dashboard/bookings?experience_event_id=${encodeURIComponent(selection.eventId)}`}
                  className="text-sm font-medium text-brand-600 hover:text-brand-800"
                  onClick={onClose}
                >
                  Open in bookings →
                </Link>
                <Link
                  href="/dashboard/event-manager"
                  className="text-sm font-medium text-slate-600 hover:text-slate-800"
                  onClick={onClose}
                >
                  Event manager →
                </Link>
              </div>
            ) : null}
          </div>

          {showBookNow ? (
            <Button type="button" variant="primary" className="w-full sm:w-auto" onClick={onBookNow}>
              Book now
            </Button>
          ) : null}

          {eventRow?.description ? (
            <p className="whitespace-pre-wrap text-sm text-slate-600">{eventRow.description}</p>
          ) : null}

          {eventRow?.ticket_types && eventRow.ticket_types.length > 0 ? (
            <div>
              <h3 className="mb-1.5 text-sm font-semibold text-slate-800">Ticket types</h3>
              <ul className="list-inside list-disc text-sm text-slate-600">
                {eventRow.ticket_types.map((t, i) => (
                  <li key={t.id ?? i}>
                    {t.name}
                    {t.capacity != null ? ` (cap ${t.capacity})` : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          {loading && !eventRow ? <p className="text-sm text-slate-500">Loading details…</p> : null}

          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-800">Bookings</h3>
            {linked && !linked.linkedPii ? (
              <p className="mb-2 text-xs text-slate-500">
                Guest contact details from {linked.ownerVenueName} are hidden on this link.
              </p>
            ) : null}
            <RegistryBookingAccordionList
              experienceEventId={selection.eventId}
              venueId={effectiveVenueId}
              ownerVenueId={linked?.ownerVenueId}
              linkedAct={linked?.linkedAct}
              venueCurrency={effectiveCurrency}
              venueTimezone={effectiveTimezone}
              hideDateInSummary
              onBookingsCountChange={setBookedGuests}
              onBookingsUpdated={() => {
                onUpdated?.();
              }}
            />
          </div>
        </div>
      </aside>
    </Sheet>
  );
}
