'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { ScheduleBlockDTO } from '@/types/schedule-blocks';
import {
  PRACTITIONER_BOOKING_STATUS_BADGE as STATUS_BADGE,
  formatDashboardMoneyPence as formatMoneyPence,
} from './detail-sheet-primitives';
import { computePopoverPanelStyle } from '@/lib/ui/clamped-floating-styles';
import { useViewportBounds } from '@/lib/ui/use-viewport-bounds';

interface ClassTypePayload {
  id: string;
  name: string;
  duration_minutes: number;
  capacity: number;
  colour?: string | null;
  instructor_name?: string | null;
}

interface InstancePayload {
  id: string;
  instance_date: string;
  start_time: string;
  is_cancelled: boolean;
  capacity_override?: number | null;
  class_type: ClassTypePayload;
}

interface AttendeeRow {
  booking_id: string;
  status: string;
  party_size: number;
  deposit_amount_pence: number | null;
  deposit_status: string | null;
  guest_name: string | null;
  guest_email: string | null;
  guest_phone: string | null;
  checked_in_at: string | null;
}

export type ClassInstanceNotice = { kind: 'success' | 'error'; message: string };

function escapeCsvCell(s: string | number | null | undefined): string {
  const str = s == null ? '' : String(s);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function formatCheckedInAt(value: string | null): string {
  if (!value) return 'Not checked in';
  return new Date(value).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' });
}

function ClassBookingConcertina({
  attendee,
  currency,
}: {
  attendee: AttendeeRow;
  currency: string;
}) {
  const guestName = attendee.guest_name ?? 'Guest';
  const contactSummary = attendee.guest_phone ?? attendee.guest_email ?? 'No contact';
  const statusClass = STATUS_BADGE[attendee.status] ?? 'bg-slate-100 text-slate-700';
  const deposit = formatMoneyPence(attendee.deposit_amount_pence, currency);

  return (
    <details className="group overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm shadow-slate-900/[0.03]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 marker:hidden">
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-bold text-slate-900">{guestName}</span>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${statusClass}`}>
              {attendee.status}
            </span>
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
            <span>{attendee.party_size} guest{attendee.party_size === 1 ? '' : 's'}</span>
            <span className="text-slate-300">·</span>
            <span className="truncate">{contactSummary}</span>
          </span>
        </span>
        <svg className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </summary>
      <div className="space-y-2 border-t border-slate-100 p-2.5">
        <div className="grid grid-cols-2 gap-1.5">
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-2 py-1.5">
            <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-500">Email</p>
            {attendee.guest_email ? (
              <a href={`mailto:${attendee.guest_email}`} className="block truncate text-xs font-bold text-slate-800 hover:text-brand-700">
                {attendee.guest_email}
              </a>
            ) : (
              <p className="truncate text-xs font-bold text-slate-400">Not provided</p>
            )}
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-2 py-1.5">
            <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-500">Telephone</p>
            {attendee.guest_phone ? (
              <a href={`tel:${attendee.guest_phone}`} className="block truncate text-xs font-bold text-slate-800 hover:text-brand-700">
                {attendee.guest_phone}
              </a>
            ) : (
              <p className="truncate text-xs font-bold text-slate-400">Not provided</p>
            )}
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-2 py-1.5">
            <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-500">Deposit</p>
            <p className="truncate text-xs font-bold text-slate-800">
              {deposit}
              {attendee.deposit_status ? <span className="ml-1 font-medium text-slate-500">({attendee.deposit_status})</span> : null}
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-2 py-1.5">
            <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-500">Checked in</p>
            <p className="truncate text-xs font-bold text-slate-800">{formatCheckedInAt(attendee.checked_in_at)}</p>
          </div>
        </div>
        <Link
          href={`/dashboard/bookings?openBooking=${encodeURIComponent(attendee.booking_id)}`}
          className="block rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-center text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          Open full booking
        </Link>
      </div>
    </details>
  );
}

interface Props {
  /** When non-null, the sheet is open. Carries the clicked schedule block for instant labels. */
  selection: { instanceId: string; block: ScheduleBlockDTO } | null;
  onClose: () => void;
  currency?: string;
  /**
   * When opened from the class timetable agenda, show roster CSV + admin cancel here
   * (same shell as calendar — bottom sheet / right drawer).
   */
  timetableContext?: boolean;
  isAdmin?: boolean;
  onSessionMutated?: () => void;
  onNotice?: (n: ClassInstanceNotice) => void;
  /** Increment after timetable edits so roster reloads without closing the sheet. */
  refreshSignal?: number;
  presentation?: 'sheet' | 'popover';
  anchor?: { x: number; y: number } | null;
}

export function ClassInstanceDetailSheet({
  selection,
  onClose,
  currency = 'GBP',
  timetableContext = false,
  isAdmin = false,
  onSessionMutated,
  onNotice,
  refreshSignal = 0,
  presentation = 'sheet',
  anchor,
}: Props) {
  const open = selection !== null;
  const panelRef = useRef<HTMLElement>(null);
  const [instance, setInstance] = useState<InstancePayload | null>(null);
  const [attendees, setAttendees] = useState<AttendeeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);

  const instanceId = selection?.instanceId ?? null;

  const load = useCallback(async () => {
    if (!instanceId) return;
    setLoading(true);
    setError(null);
    try {
      const [instRes, attRes] = await Promise.all([
        fetch(`/api/venue/class-instances/${instanceId}`),
        fetch(`/api/venue/class-instances/${instanceId}/attendees`),
      ]);
      if (!instRes.ok) {
        const j = await instRes.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error ?? 'Could not load class');
      }
      if (!attRes.ok) {
        const j = await attRes.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error ?? 'Could not load roster');
      }
      const instJson = (await instRes.json()) as InstancePayload;
      const attJson = (await attRes.json()) as { attendees?: AttendeeRow[] };
      setInstance(instJson);
      setAttendees(attJson.attendees ?? []);
    } catch (e) {
      setInstance(null);
      setAttendees([]);
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }, [instanceId]);

  useEffect(() => {
    if (!selection || !instanceId) {
      setInstance(null);
      setAttendees([]);
      setError(null);
      return;
    }
    void load();
  }, [selection, instanceId, load, refreshSignal]);

  const viewport = useViewportBounds();
  const isPopover = presentation === 'popover';
  const popoverStyle = useMemo((): CSSProperties | undefined => {
    if (!isPopover) return undefined;

    return computePopoverPanelStyle({
      anchorX: anchor?.x ?? viewport.width / 2,
      anchorY: anchor?.y ?? 120,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      maxPanelWidth: 640,
    });
  }, [anchor?.x, anchor?.y, isPopover, viewport.height, viewport.width]);

  useEffect(() => {
    if (!isPopover || !open) return;

    const onPointerDownCapture = (event: PointerEvent) => {
      if (panelRef.current?.contains(event.target as Node)) return;
      event.preventDefault();
      event.stopPropagation();
    };

    const onClickCapture = (event: MouseEvent) => {
      if (panelRef.current?.contains(event.target as Node)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      onClose();
    };

    document.addEventListener('pointerdown', onPointerDownCapture, true);
    document.addEventListener('click', onClickCapture, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDownCapture, true);
      document.removeEventListener('click', onClickCapture, true);
    };
  }, [isPopover, onClose, open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, open]);

  const downloadCsv = useCallback(() => {
    if (!instance || attendees.length === 0) return;
    const headers = ['Guest name', 'Email', 'Phone', 'Party size', 'Status', 'Deposit (pence)', 'Deposit status', 'Checked in'];
    const lines = [
      headers.join(','),
      ...attendees.map((a) =>
        [
          escapeCsvCell(a.guest_name),
          escapeCsvCell(a.guest_email),
          escapeCsvCell(a.guest_phone),
          escapeCsvCell(a.party_size),
          escapeCsvCell(a.status),
          escapeCsvCell(a.deposit_amount_pence),
          escapeCsvCell(a.deposit_status),
          escapeCsvCell(a.checked_in_at ? new Date(a.checked_in_at).toISOString() : ''),
        ].join(','),
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `class-roster-${instance.id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [instance, attendees]);

  const handleCancelInstance = useCallback(async () => {
    if (!instanceId || !instance || !timetableContext || !isAdmin) return;
    const ok = window.confirm(
      `Cancel this "${instance.class_type.name}" class on ${instance.instance_date}? Enrolled guests will be notified and refunds follow your policy.`,
    );
    if (!ok) return;
    setCancelLoading(true);
    try {
      const res = await fetch(`/api/venue/class-instances/${instanceId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        onNotice?.({ kind: 'error', message: data.error ?? 'Could not cancel class' });
        return;
      }
      onNotice?.({ kind: 'success', message: 'Class cancelled.' });
      onClose();
      onSessionMutated?.();
    } catch {
      onNotice?.({ kind: 'error', message: 'Could not cancel class' });
    } finally {
      setCancelLoading(false);
    }
  }, [instanceId, instance, timetableContext, isAdmin, onClose, onNotice, onSessionMutated]);

  if (!open || !selection) return null;

  const block = selection.block;
  const ct = instance?.class_type;
  const titleFromBlock =
    block.title.includes('·') ? block.title.split('·')[0]?.trim() ?? block.title : block.title;
  const title = ct?.name ?? titleFromBlock;
  const dateStr = instance?.instance_date ?? block.date;
  const startStr = instance?.start_time ? String(instance.start_time).slice(0, 5) : block.start_time;
  const endStr = block.end_time;
  const cap =
    instance?.capacity_override != null && instance.capacity_override > 0
      ? instance.capacity_override
      : ct?.capacity ?? block.class_capacity;
  const bookedActive = attendees
    .filter((a) => a.status !== 'Cancelled')
    .reduce((s, a) => s + (a.party_size ?? 1), 0);
  const bookedDisplay =
    loading && attendees.length === 0 ? (block.class_booked_spots ?? 0) : bookedActive;
  const popoverDismissLayer = isPopover ? (
    <button
      type="button"
      tabIndex={-1}
      aria-label="Close class details"
      className="fixed inset-0 z-40 cursor-default bg-transparent p-0"
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    />
  ) : null;

  if (isPopover) {
    return (
      <>
        {popoverDismissLayer}
        <div className="fixed z-50" style={popoverStyle}>
          <aside
            ref={panelRef}
            className="max-h-[inherit] min-w-0 max-w-full overflow-x-hidden overflow-y-auto rounded-2xl border border-slate-200/80 bg-white shadow-2xl shadow-slate-900/15 ring-1 ring-slate-100"
            role="dialog"
            aria-labelledby="class-detail-title"
            aria-modal="false"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-start justify-between gap-2 border-b border-slate-100 bg-white/95 px-2.5 py-2 backdrop-blur">
              <div className="min-w-0">
                <h2 id="class-detail-title" className="truncate text-[13px] font-semibold text-slate-900">
                  {title}
                </h2>
                <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] font-medium text-slate-600">
                  <span>{dateStr}</span>
                  <span className="text-slate-300">·</span>
                  <span className="tabular-nums">{startStr} - {endStr}</span>
                  {ct ? (
                    <>
                      <span className="text-slate-300">·</span>
                      <span>{ct.duration_minutes} min</span>
                    </>
                  ) : null}
                </p>
                {ct?.instructor_name ? (
                  <p className="truncate text-[11px] text-slate-500">Instructor: {ct.instructor_name}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                aria-label="Close class detail"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-1.5 p-2">
              <div className="rounded-xl border border-brand-200 bg-gradient-to-br from-brand-50 via-white to-white p-2">
                <p className="text-[9px] font-semibold uppercase tracking-widest text-brand-600">Class session</p>
                <p className="mt-0.5 text-lg font-bold leading-tight tracking-tight text-slate-950 tabular-nums">
                  {startStr} - {endStr}
                </p>
                <p className="text-[11px] text-slate-600">
                  <span className="font-semibold text-slate-900">{bookedDisplay}</span>
                  {cap != null ? ` / ${cap} booked` : ' spots taken'}
                </p>
                {instance?.is_cancelled ? (
                  <span className="mt-1.5 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                    Session cancelled
                  </span>
                ) : null}
              </div>

              {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div> : null}
              {loading && !instance ? <p className="px-1 text-sm text-slate-500">Loading details...</p> : null}

              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2 px-1">
                  <h3 className="text-xs font-semibold text-slate-800">Bookings & guests</h3>
                  {!loading ? (
                    <span className="text-[11px] font-medium text-slate-400">
                      {attendees.length} booking{attendees.length === 1 ? '' : 's'}
                    </span>
                  ) : null}
                </div>
                {loading && attendees.length === 0 && !error ? (
                  <p className="px-1 text-sm text-slate-500">Loading roster...</p>
                ) : attendees.length === 0 ? (
                  <p className="px-1 text-sm text-slate-500">No bookings for this session.</p>
                ) : (
                  attendees.map((attendee) => (
                    <ClassBookingConcertina
                      key={attendee.booking_id}
                      attendee={attendee}
                      currency={currency}
                    />
                  ))
                )}
              </div>

              <Link
                href="/dashboard/class-timetable"
                className="block rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-center text-xs font-medium text-brand-600 hover:bg-slate-50 hover:text-brand-800"
                onClick={onClose}
              >
                Class timetable
              </Link>
            </div>
          </aside>
        </div>
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-50 bg-black/40 lg:bg-black/20"
        aria-label="Close panel"
        onClick={onClose}
      />
      <aside
        className="fixed inset-x-0 bottom-0 z-50 max-h-[90dvh] overflow-y-auto rounded-t-2xl border border-slate-200 bg-white shadow-2xl animate-slide-in-bottom lg:inset-y-0 lg:right-0 lg:left-auto lg:max-h-none lg:w-full lg:max-w-lg lg:rounded-none lg:rounded-l-2xl lg:border-l lg:border-t-0 lg:border-r-0 lg:border-b-0 lg:animate-slide-in-right"
        role="dialog"
        aria-labelledby="class-detail-title"
        aria-modal="true"
      >
        <div className="sticky top-0 z-[1] flex items-start justify-between gap-3 border-b border-slate-100 bg-white px-4 py-3">
          <div className="min-w-0">
            <h2 id="class-detail-title" className="text-lg font-semibold text-slate-900">
              {title}
            </h2>
            <p className="mt-0.5 text-sm text-slate-600">
              {dateStr} · {startStr} – {endStr}
              {ct ? ` · ${ct.duration_minutes} min` : null}
            </p>
            {instance?.is_cancelled ? (
              <span className="mt-2 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                Session cancelled
              </span>
            ) : null}
            {ct?.instructor_name ? (
              <p className="mt-1 text-xs text-slate-500">Instructor: {ct.instructor_name}</p>
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
                  / {cap} booked
                </>
              ) : (
                ' spots taken'
              )}
            </span>
            {!timetableContext ? (
              <Link
                href="/dashboard/class-timetable"
                className="text-sm font-medium text-brand-600 hover:text-brand-800"
                onClick={onClose}
              >
                Class timetable →
              </Link>
            ) : null}
          </div>

          {timetableContext && (attendees.length > 0 || (isAdmin && instance && !instance.is_cancelled)) ? (
            <div className="flex flex-wrap gap-2">
              {attendees.length > 0 ? (
                <button
                  type="button"
                  onClick={downloadCsv}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50"
                >
                  Download CSV
                </button>
              ) : null}
              {isAdmin && instance && !instance.is_cancelled ? (
                <button
                  type="button"
                  onClick={() => void handleCancelInstance()}
                  disabled={cancelLoading}
                  className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-800 hover:bg-red-100 disabled:opacity-50"
                >
                  {cancelLoading ? 'Cancelling…' : 'Cancel class & notify guests'}
                </button>
              ) : null}
            </div>
          ) : null}

          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          {loading && !instance ? <p className="text-sm text-slate-500">Loading details…</p> : null}

          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-800">Bookings & guests</h3>
            {loading && attendees.length === 0 && !error ? (
              <p className="text-sm text-slate-500">Loading roster…</p>
            ) : attendees.length === 0 ? (
              <p className="text-sm text-slate-500">No bookings for this session.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full min-w-[400px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                      <th className="px-3 py-2 font-medium">Guest</th>
                      <th className="px-3 py-2 font-medium">Contact</th>
                      <th className="px-3 py-2 font-medium">Qty</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2 font-medium">Deposit</th>
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
                          <div className="max-w-[140px] truncate text-xs">{a.guest_email ?? '—'}</div>
                          <div className="text-[11px] text-slate-500">{a.guest_phone ?? ''}</div>
                        </td>
                        <td className="px-3 py-2 text-slate-700">{a.party_size}</td>
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
                          {a.checked_in_at
                            ? new Date(a.checked_in_at).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {!timetableContext ? (
            <p className="text-xs text-slate-400">
              Cancel and CSV export are available on the class timetable.
            </p>
          ) : null}
        </div>
      </aside>
    </>
  );
}
