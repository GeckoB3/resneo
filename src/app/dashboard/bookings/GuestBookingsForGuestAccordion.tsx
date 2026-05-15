'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { StaffSurfaceBookingModal } from '@/components/booking/StaffSurfaceBookingModal';
import { calendarDateInTimeZone } from '@/lib/guests/guest-contacts-list';
import type { BookingDetailPanelSnapshot } from '@/app/dashboard/bookings/booking-detail-panel-snapshot';
import {
  bookingExpandAccordionBodyClass,
  bookingExpandAccordionDetailsClass,
  bookingExpandAccordionSummaryClass,
} from '@/app/dashboard/bookings/booking-expand-accordion-classes';
import { readResponseJson } from '@/lib/http/read-response-json';
import type { BookingModel } from '@/types/booking-models';
import { normalizeEnabledModels } from '@/lib/booking/enabled-models';
import type { StaffRebookBootstrapPayloadV1, StaffRebookGuestPrefill } from '@/lib/booking/staff-rebook-bootstrap';
import { writeStaffRebookBootstrap } from '@/lib/booking/staff-rebook-bootstrap';
import { staffBookingSurfaceTabIdToQueryParam } from '@/lib/booking/staff-booking-modal-options';
import {
  bookingSourceDurationMinutes,
  bookingSourceWallEndHm,
  buildStaffRebookBootstrapFromBookingSource,
} from '@/lib/booking/staff-rebook-from-booking-source';

/** Venue defaults loaded for staff rebook modal (guest-history accordion). */
interface GuestBookingsStaffVenueDefaults {
  venueId: string;
  currency: string;
  bookingModel: BookingModel;
  enabledModels: BookingModel[];
  tableManagementEnabled: boolean;
}
export const BOOKING_DETAIL_MAX_STACK_DEPTH = 8;

export interface GuestBookingHistoryRow {
  id: string;
  booking_date: string;
  booking_time: string;
  party_size: number;
  status: string;
  estimated_end_time: string | null;
  /** Wall-clock segment end when `estimated_end_time` is unavailable (PostgreSQL `time`). */
  booking_end_time?: string | null;
  booking_item_name: string | null;
  booking_model?: string | null;
  experience_event_id?: string | null;
  class_instance_id?: string | null;
  resource_id?: string | null;
  event_session_id?: string | null;
  calendar_id?: string | null;
  /** Resolved from `unified_calendars` when `calendar_id` is set (`GET /api/venue/bookings/list`). */
  calendar_name?: string | null;
  service_item_id?: string | null;
  practitioner_id?: string | null;
  appointment_service_id?: string | null;
  service_id?: string | null;
  service_variant_id?: string | null;
  /** Dining area FK when assigned. */
  area_id?: string | null;
  /** Dinner / seating area when assigned (see `GET /api/venue/bookings/list`). */
  area_name?: string | null;
}

export interface GuestHistoryRelatedBookingPayload {
  bookingId: string;
  snapshot: BookingDetailPanelSnapshot;
  row: GuestBookingHistoryRow;
}

function formatDateNice(value: string): string {
  const d = new Date(`${value}T12:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** HH:mm from DB ISO timestamp; null if missing or unparseable (avoids Invalid Date / RangeError on toISOString). */
function estimatedEndToHHMM(iso: string | null | undefined): string | null {
  if (iso == null || typeof iso !== 'string' || !iso.trim()) return null;
  const d = new Date(iso.trim());
  if (!Number.isNaN(d.getTime())) {
    return d.toISOString().slice(11, 16);
  }
  const afterT = iso.includes('T') ? iso.split('T')[1] : null;
  const hm = (afterT ?? iso).slice(0, 5);
  if (/^\d{2}:\d{2}$/.test(hm)) return hm;
  return null;
}

function wallClockHHMMInVenue(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const hh = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const mm = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${hh}:${mm}`;
}

function isBookingUpcomingInVenue(
  bookingDate: string,
  bookingTimeHm: string,
  now: Date,
  venueTimeZone: string,
): boolean {
  const today = calendarDateInTimeZone(now, venueTimeZone);
  if (bookingDate > today) return true;
  if (bookingDate < today) return false;
  const nowHm = wallClockHHMMInVenue(now, venueTimeZone);
  return bookingTimeHm >= nowHm;
}

function parseEstimatedEndInstantMs(iso: string | null | undefined): number | null {
  if (!iso?.trim()) return null;
  const ms = new Date(iso.trim()).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** Postgres `time` → HH:mm when parseable */
function bookingEndWallHm(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const t = raw.trim();
  const hm = t.length >= 5 ? t.slice(0, 5) : t;
  return /^\d{2}:\d{2}$/.test(hm) ? hm : null;
}

function guestBookingHistoryTimeRange(row: GuestBookingHistoryRow): string {
  const st = row.booking_time.length >= 5 ? row.booking_time.slice(0, 5) : row.booking_time;
  const endHm = bookingSourceWallEndHm(row);
  if (endHm && endHm !== st) return `${st}–${endHm}`;
  return st;
}

function guestBookingHistoryDurationLabel(row: GuestBookingHistoryRow): string | null {
  const mins = bookingSourceDurationMinutes(row);
  if (mins == null) return null;
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

const guestBookingBarBaseClass =
  'flex min-w-0 items-start justify-between gap-2 rounded-lg border border-slate-200/90 bg-white px-2.5 py-2 shadow-sm ring-1 ring-slate-900/[0.03]';
const guestBookingBarCurrentClass =
  `${guestBookingBarBaseClass} border-brand-200/80 bg-brand-50/50 ring-brand-100`;

function GuestBookingHistoryBar({
  row: r,
  currentBookingId,
  canOpenNested,
  guestDisplayNameForSnapshots,
  onOpenBookingDetail,
  showRebook,
  onRebook,
}: {
  row: GuestBookingHistoryRow;
  currentBookingId: string;
  canOpenNested: boolean;
  guestDisplayNameForSnapshots: string;
  onOpenBookingDetail: (payload: GuestHistoryRelatedBookingPayload) => void;
  showRebook: boolean;
  onRebook: (row: GuestBookingHistoryRow) => void;
}) {
  const isThisBooking = r.id === currentBookingId;
  const timeRange = guestBookingHistoryTimeRange(r);
  const durationLabel = guestBookingHistoryDurationLabel(r);
  const serviceLabel =
    typeof r.booking_item_name === 'string' && r.booking_item_name.trim() !== '' ? r.booking_item_name.trim() : null;
  const calendarLabel =
    typeof r.calendar_name === 'string' && r.calendar_name.trim() !== '' ? r.calendar_name.trim() : null;
  const areaLabel =
    typeof r.area_name === 'string' && r.area_name.trim() !== '' ? r.area_name.trim() : null;
  const secondaryLocationLabel = calendarLabel ?? areaLabel;

  return (
    <li className={isThisBooking ? guestBookingBarCurrentClass : guestBookingBarBaseClass} aria-current={isThisBooking ? 'true' : undefined}>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-1 text-[11px] tabular-nums leading-snug text-slate-800">
          <span className="font-semibold text-slate-900">{formatDateNice(r.booking_date)}</span>
          <span className="text-slate-300" aria-hidden>
            ·
          </span>
          <span className="font-semibold text-slate-800">{timeRange}</span>
          {durationLabel ? (
            <>
              <span className="text-slate-300" aria-hidden>
                ·
              </span>
              <span className="font-medium text-slate-600">{durationLabel}</span>
            </>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-[11px] text-slate-600">
          <span className={`min-w-0 font-semibold ${serviceLabel ? 'text-slate-800' : 'font-medium text-slate-400 italic'}`}>
            {serviceLabel ?? 'No service'}
          </span>
          {secondaryLocationLabel ? (
            <>
              <span className="shrink-0 text-slate-300">·</span>
              <span className="min-w-0 max-w-[min(14rem,100%)] truncate text-slate-600" title={secondaryLocationLabel}>
                {secondaryLocationLabel}
              </span>
            </>
          ) : null}
        </div>
      </div>
      {isThisBooking ? (
        <span
          className="shrink-0 self-center rounded-lg border border-brand-200 bg-brand-50 px-2.5 py-1.5 text-[11px] font-semibold text-brand-800"
          title="The booking expanded above"
        >
          This booking
        </span>
      ) : (
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1 self-center">
          {showRebook ? (
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onRebook(r);
              }}
              className="rounded-lg border border-brand-200 bg-brand-50 px-2 py-1.5 text-[11px] font-semibold text-brand-800 shadow-sm ring-1 ring-brand-100/80 hover:bg-brand-100/70"
            >
              Rebook
            </button>
          ) : null}
          <button
            type="button"
            disabled={!canOpenNested}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onOpenBookingDetail({
                bookingId: r.id,
                snapshot: rowToBookingDetailSnapshot(r, guestDisplayNameForSnapshots),
                row: r,
              });
            }}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 shadow-sm ring-1 ring-slate-900/[0.03] hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-40"
          >
            Detail
          </button>
        </div>
      )}
    </li>
  );
}

/**
 * Upcoming = scheduled end time is still in the future (same instant/wall rules as dashboard).
 * When no end boundary exists, falls back to start-time-based “today / future”.
 */
function isBookingUpcomingBeforeScheduledEnd(
  row: GuestBookingHistoryRow,
  now: Date,
  venueTimeZone: string,
): boolean {
  const endInstant = parseEstimatedEndInstantMs(row.estimated_end_time);
  if (endInstant !== null) {
    return now.getTime() < endInstant;
  }

  const endHm = bookingEndWallHm(row.booking_end_time ?? null);
  const todayVenue = calendarDateInTimeZone(now, venueTimeZone);
  const startHm =
    typeof row.booking_time === 'string' && row.booking_time.length >= 5 ? row.booking_time.slice(0, 5) : '00:00';

  if (row.booking_date > todayVenue) return true;
  if (row.booking_date < todayVenue) return false;

  if (endHm) {
    const nowHm = wallClockHHMMInVenue(now, venueTimeZone);
    return nowHm < endHm;
  }

  return isBookingUpcomingInVenue(row.booking_date, startHm, now, venueTimeZone);
}

export function rowToBookingDetailSnapshot(row: GuestBookingHistoryRow, guestDisplayName: string): BookingDetailPanelSnapshot {
  const st = row.booking_time.slice(0, 5);
  const parsedEnd = estimatedEndToHHMM(row.estimated_end_time);
  const wallEndHm = bookingEndWallHm(row.booking_end_time ?? null);
  const endTime = parsedEnd ?? wallEndHm ?? st;
  const serviceLabel =
    typeof row.booking_item_name === 'string' && row.booking_item_name.trim() !== ''
      ? row.booking_item_name.trim()
      : null;
  return {
    bookingDate: row.booking_date,
    guestName: guestDisplayName,
    partySize: row.party_size,
    status: row.status,
    startTime: st,
    endTime,
    serviceName: serviceLabel,
  };
}

export function GuestBookingsForGuestAccordion({
  guestId,
  currentBookingId,
  guestDisplayNameForSnapshots,
  venueTimeZone,
  canOpenNested,
  onOpenBookingDetail,
  listRefreshKey,
  rebookGuestPrefill,
  onStaffBookingCreated,
}: {
  guestId: string | null | undefined;
  currentBookingId: string;
  /** Used when opening a related booking (placeholder snapshot). */
  guestDisplayNameForSnapshots: string;
  venueTimeZone: string;
  canOpenNested: boolean;
  onOpenBookingDetail: (payload: GuestHistoryRelatedBookingPayload) => void;
  /** Bumped when this panel reloads booking detail so the list stays in sync after edits. */
  listRefreshKey: number;
  /** Guest + booking notes for staff rebook prefill (optional). */
  rebookGuestPrefill?: StaffRebookGuestPrefill;
  /** After a booking is created from the Rebook modal (refresh parent lists / detail). */
  onStaffBookingCreated?: () => void;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<GuestBookingHistoryRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [staffVenueDefaults, setStaffVenueDefaults] = useState<GuestBookingsStaffVenueDefaults | null>(null);
  const [rebookModalBootstrap, setRebookModalBootstrap] = useState<StaffRebookBootstrapPayloadV1 | null>(null);
  const [rebookModalEpoch, setRebookModalEpoch] = useState(0);

  useEffect(() => {
    setRebookModalBootstrap(null);
  }, [guestId]);

  useEffect(() => {
    if (!guestId) {
      setStaffVenueDefaults(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [venueRes, tablesRes] = await Promise.all([
          fetch('/api/venue'),
          fetch('/api/venue/tables').catch(() => null),
        ]);
        if (!venueRes.ok || cancelled) return;
        const data = (await venueRes.json()) as Record<string, unknown>;
        const activeModels = Array.isArray(data.active_booking_models)
          ? (data.active_booking_models as BookingModel[])
          : [];
        const primary =
          (activeModels.length > 0 ? activeModels[0] : (data.booking_model as BookingModel)) ??
          'table_reservation';
        const enabledModels = normalizeEnabledModels(data.enabled_models, primary);
        let tableManagementEnabled = false;
        if (tablesRes?.ok) {
          const td = (await tablesRes.json()) as { settings?: { table_management_enabled?: boolean } };
          tableManagementEnabled = Boolean(td.settings?.table_management_enabled);
        }
        const venueIdStr = typeof data.id === 'string' ? data.id : '';
        const currency = typeof data.currency === 'string' ? data.currency : 'GBP';
        if (!cancelled && venueIdStr) {
          setStaffVenueDefaults({
            venueId: venueIdStr,
            currency,
            bookingModel: primary,
            enabledModels,
            tableManagementEnabled,
          });
        }
      } catch {
        if (!cancelled) setStaffVenueDefaults(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [guestId]);

  const handleRebookRow = useCallback(
    (row: GuestBookingHistoryRow) => {
      const payload = buildStaffRebookBootstrapFromBookingSource(row, rebookGuestPrefill);
      if (!payload) return;
      if (staffVenueDefaults?.venueId) {
        setRebookModalEpoch((e) => e + 1);
        setRebookModalBootstrap(payload);
        return;
      }
      writeStaffRebookBootstrap(payload);
      void router.push(`/dashboard/bookings/new?tab=${staffBookingSurfaceTabIdToQueryParam(payload.surface)}`);
    },
    [rebookGuestPrefill, router, staffVenueDefaults?.venueId],
  );

  useEffect(() => {
    if (!guestId) {
      setRows(null);
      setFetchError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setFetchError(null);
    void (async () => {
      try {
        const qs = new URLSearchParams({
          guest: guestId,
          guest_history: '1',
        });
        const res = await fetch(`/api/venue/bookings/list?${qs.toString()}`);
        const payload = await readResponseJson<{ error?: string; bookings?: GuestBookingHistoryRow[] }>(res);
        if (!res.ok) {
          if (!cancelled) {
            setFetchError(typeof payload.error === 'string' ? payload.error : 'Could not load bookings');
            setRows([]);
          }
          return;
        }
        const list = (payload.bookings ?? []).filter((b) => b && typeof b.id === 'string');
        if (!cancelled) {
          setRows(list);
          setFetchError(null);
        }
      } catch {
        if (!cancelled) {
          setFetchError('Could not load bookings');
          setRows([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [guestId, listRefreshKey]);

  const { upcomingRows, previousRows } = useMemo(() => {
    if (!rows?.length) {
      return { upcomingRows: [] as GuestBookingHistoryRow[], previousRows: [] as GuestBookingHistoryRow[] };
    }
    const now = new Date();
    const upcoming = rows.filter((r) => isBookingUpcomingBeforeScheduledEnd(r, now, venueTimeZone));
    const previous = rows.filter((r) => !isBookingUpcomingBeforeScheduledEnd(r, now, venueTimeZone));
    upcoming.sort((a, b) => {
      const dc = a.booking_date.localeCompare(b.booking_date);
      if (dc !== 0) return dc;
      return a.booking_time.localeCompare(b.booking_time);
    });
    previous.sort((a, b) => {
      const dc = b.booking_date.localeCompare(a.booking_date);
      if (dc !== 0) return dc;
      return b.booking_time.localeCompare(a.booking_time);
    });
    return { upcomingRows: upcoming, previousRows: previous };
  }, [rows, venueTimeZone]);

  if (!guestId) return null;

  const summaryHint = (() => {
    if (loading && !rows?.length) return 'Loading bookings…';
    if (fetchError) return 'Could not load';
    if (!rows) return 'Other visits for this guest';
    return `${upcomingRows.length} upcoming · ${previousRows.length} previous`;
  })();

  return (
    <>
      <details className={bookingExpandAccordionDetailsClass}>
      <summary className={bookingExpandAccordionSummaryClass}>
        <span>Guest bookings</span>
        <span className="text-[11px] font-medium text-slate-400 group-open:hidden">{summaryHint}</span>
        <svg className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </summary>
      <div className={`${bookingExpandAccordionBodyClass} space-y-3`}>
        {loading && !rows?.length ? (
          <p className="text-[11px] text-slate-500">Loading…</p>
        ) : fetchError ? (
          <p className="text-[11px] font-medium text-red-700">{fetchError}</p>
        ) : (
          <>
            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Upcoming</p>
              {upcomingRows.length === 0 ? (
                <p className="text-[11px] text-slate-400">None</p>
              ) : (
                <ul className="grid gap-2">
                  {upcomingRows.map((r) => (
                    <GuestBookingHistoryBar
                      key={r.id}
                      row={r}
                      currentBookingId={currentBookingId}
                      canOpenNested={canOpenNested}
                      guestDisplayNameForSnapshots={guestDisplayNameForSnapshots}
                      onOpenBookingDetail={onOpenBookingDetail}
                      showRebook={buildStaffRebookBootstrapFromBookingSource(r, {}) !== null}
                      onRebook={handleRebookRow}
                    />
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Previous</p>
              {previousRows.length === 0 ? (
                <p className="text-[11px] text-slate-400">None</p>
              ) : (
                <ul className="grid gap-2">
                  {previousRows.map((r) => (
                    <GuestBookingHistoryBar
                      key={r.id}
                      row={r}
                      currentBookingId={currentBookingId}
                      canOpenNested={canOpenNested}
                      guestDisplayNameForSnapshots={guestDisplayNameForSnapshots}
                      onOpenBookingDetail={onOpenBookingDetail}
                      showRebook={buildStaffRebookBootstrapFromBookingSource(r, {}) !== null}
                      onRebook={handleRebookRow}
                    />
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
      </details>

      {rebookModalBootstrap && staffVenueDefaults ? (
        <StaffSurfaceBookingModal
          open
          heading="Rebook"
          onClose={() => setRebookModalBootstrap(null)}
          onCreated={() => {
            setRebookModalBootstrap(null);
            onStaffBookingCreated?.();
          }}
          venueId={staffVenueDefaults.venueId}
          currency={staffVenueDefaults.currency}
          bookingModel={staffVenueDefaults.bookingModel}
          enabledModels={staffVenueDefaults.enabledModels}
          intent="new"
          advancedMode={staffVenueDefaults.tableManagementEnabled}
          staffRebookBootstrap={rebookModalBootstrap}
          stackKey={rebookModalEpoch}
        />
      ) : null}
    </>
  );
}
