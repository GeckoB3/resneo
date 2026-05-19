'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { ScheduleBlockDTO } from '@/types/schedule-blocks';
import {
  PRACTITIONER_BOOKING_STATUS_BADGE as STATUS_BADGE,
  formatDashboardMoneyPence as formatMoneyPence,
} from './detail-sheet-primitives';
import { Sheet } from '@/components/ui/primitives/Sheet';

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

interface TicketLineRow {
  label: string;
  quantity: number;
  unit_price_pence: number;
}

interface AttendeeRow {
  booking_id: string;
  status: string;
  party_size: number;
  deposit_amount_pence: number | null;
  deposit_status: string | null;
  booking_date: string;
  booking_time: string;
  checked_in_at: string | null;
  guest_name: string | null;
  guest_email: string | null;
  guest_phone: string | null;
  ticket_lines: TicketLineRow[];
}


function ticketLinesSummary(lines: TicketLineRow[]): string {
  if (!lines.length) return '—';
  return lines.map((l) => `${l.label} ×${l.quantity}`).join(', ');
}

interface Props {
  selection: { eventId: string; block: ScheduleBlockDTO } | null;
  onClose: () => void;
  currency?: string;
}

export function EventInstanceDetailSheet({ selection, onClose, currency = 'GBP' }: Props) {
  const open = selection !== null;
  const [eventRow, setEventRow] = useState<ExperienceEventPayload | null>(null);
  const [attendees, setAttendees] = useState<AttendeeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const eventId = selection?.eventId ?? null;

  const load = useCallback(async () => {
    if (!eventId) return;
    setLoading(true);
    setError(null);
    try {
      const [evRes, attRes] = await Promise.all([
        fetch(`/api/venue/experience-events/${eventId}`),
        fetch(`/api/venue/experience-events/${eventId}/attendees`),
      ]);
      if (!evRes.ok) {
        const j = await evRes.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error ?? 'Could not load event');
      }
      if (!attRes.ok) {
        const j = await attRes.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error ?? 'Could not load bookings');
      }
      const evJson = (await evRes.json()) as ExperienceEventPayload;
      const attJson = (await attRes.json()) as { attendees?: AttendeeRow[] };
      setEventRow(evJson);
      setAttendees(attJson.attendees ?? []);
    } catch (e) {
      setEventRow(null);
      setAttendees([]);
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    if (!selection || !eventId) {
      setEventRow(null);
      setAttendees([]);
      setError(null);
      return;
    }
    void load();
  }, [selection, eventId, load]);

  if (!open || !selection) return null;

  const block = selection.block;
  const title = eventRow?.name ?? block.title;
  const dateStr = eventRow?.event_date ?? block.date;
  const startStr = eventRow?.start_time ? String(eventRow.start_time).slice(0, 5) : block.start_time.slice(0, 5);
  const endStr = eventRow?.end_time ? String(eventRow.end_time).slice(0, 5) : block.end_time.slice(0, 5);
  const cap = eventRow?.capacity ?? block.event_capacity;

  const bookedActive = attendees
    .filter((a) => a.status !== 'Cancelled')
    .reduce((s, a) => s + (a.party_size ?? 1), 0);
  const bookedDisplay =
    loading && attendees.length === 0 ? (block.event_party_total ?? 0) : bookedActive;

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
      contentClassName="flex max-h-[90dvh] flex-col overflow-hidden p-0 lg:max-h-none lg:max-w-lg"
    >
      <aside className="flex min-h-0 flex-1 flex-col overflow-y-auto" aria-labelledby="event-detail-title">
        <div className="sticky top-0 z-[1] flex items-start justify-between gap-3 border-b border-slate-100 bg-white px-4 py-3">
          <div className="min-w-0">
            <h2 id="event-detail-title" className="text-lg font-semibold text-slate-900">
              {title}
            </h2>
            <p className="mt-0.5 text-sm text-slate-600">
              {dateStr} · {startStr} – {endStr}
            </p>
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
            </span>
            <Link
              href="/dashboard/event-manager"
              className="text-sm font-medium text-brand-600 hover:text-brand-800"
              onClick={onClose}
            >
              Event manager →
            </Link>
          </div>

          {eventRow?.description ? (
            <p className="text-sm text-slate-600 whitespace-pre-wrap">{eventRow.description}</p>
          ) : null}

          {eventRow?.ticket_types && eventRow.ticket_types.length > 0 ? (
            <div>
              <h3 className="mb-1.5 text-sm font-semibold text-slate-800">Ticket types</h3>
              <ul className="list-inside list-disc text-sm text-slate-600">
                {eventRow.ticket_types.map((t, i) => (
                  <li key={t.id ?? i}>
                    {t.name} — {formatMoneyPence(t.price_pence, currency)}
                    {t.capacity != null ? ` (cap ${t.capacity})` : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          {loading && !eventRow ? <p className="text-sm text-slate-500">Loading details…</p> : null}

          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-800">Bookings & guests</h3>
            {loading && attendees.length === 0 && !error ? (
              <p className="text-sm text-slate-500">Loading bookings…</p>
            ) : attendees.length === 0 ? (
              <p className="text-sm text-slate-500">No bookings for this event.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full min-w-[480px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                      <th className="px-3 py-2 font-medium">Guest</th>
                      <th className="px-3 py-2 font-medium">Contact</th>
                      <th className="px-3 py-2 font-medium">Party</th>
                      <th className="px-3 py-2 font-medium">Tickets</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2 font-medium">Deposit</th>
                      <th className="px-3 py-2 font-medium">Time</th>
                      <th className="px-3 py-2 font-medium">Checked in</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attendees.map((a) => (
                      <tr
                        key={a.booking_id}
                        className={`border-b border-slate-100 last:border-0 ${a.status === 'Cancelled' ? 'opacity-60' : ''}`}
                      >
                        <td className="px-3 py-2 font-medium text-slate-900">{a.guest_name ?? '—'}</td>
                        <td className="px-3 py-2 text-slate-600">
                          <div className="max-w-[120px] truncate text-xs">{a.guest_email ?? '—'}</div>
                          <div className="text-[11px] text-slate-500">{a.guest_phone ?? ''}</div>
                        </td>
                        <td className="px-3 py-2 text-slate-700">{a.party_size}</td>
                        <td className="max-w-[140px] px-3 py-2 text-xs text-slate-600">
                          {ticketLinesSummary(a.ticket_lines)}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[a.status] ?? 'bg-slate-100 text-slate-700'}`}
                          >
                            {a.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-slate-600">
                          {formatMoneyPence(a.deposit_amount_pence, currency)}
                          {a.deposit_status ? (
                            <span className="ml-1 text-[10px] text-slate-400">({a.deposit_status})</span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-600">
                          {String(a.booking_time).slice(0, 5)}
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-600">
                          {a.checked_in_at
                            ? new Date(a.checked_in_at).toLocaleString('en-GB', {
                                dateStyle: 'short',
                                timeStyle: 'short',
                              })
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </aside>
    </Sheet>
  );
}
