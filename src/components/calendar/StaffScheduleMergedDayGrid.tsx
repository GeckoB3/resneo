'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ScheduleFeedColumn } from '@/app/dashboard/practitioner-calendar/ScheduleFeedColumn';
import { getCalendarGridBounds } from '@/lib/venue-calendar-bounds';
import { minutesToTime } from '@/lib/availability';
import { venueExposesBookingModel } from '@/lib/booking/enabled-models';
import type { BookingModel } from '@/types/booking-models';
import type { OpeningHours } from '@/types/availability';
import type { ScheduleBlockDTO } from '@/types/schedule-blocks';
import { useDashboardVenueBootstrap } from '@/components/providers/DashboardVenueBootstrapProvider';

const SLOT_HEIGHT = 48;
const SLOT_MINUTES = 15;

interface Props {
  date: string;
  bookingModel: BookingModel;
  enabledModels: BookingModel[];
}

/**
 * Merged Events / Resources day columns (GET /api/venue/schedule). Used by legacy hub flows;
 * the main `/dashboard/calendar` route uses `PractitionerCalendarView` with user calendar columns.
 * Does not include Model A tables.
 */
export function StaffScheduleMergedDayGrid({ date, bookingModel, enabledModels }: Props) {
  const venueBootstrap = useDashboardVenueBootstrap();
  const router = useRouter();
  const gridScrollRef = useRef<HTMLDivElement>(null);
  const [openingHours, setOpeningHours] = useState<OpeningHours | null>(null);
  const [venueTimezone, setVenueTimezone] = useState<string>('Europe/London');
  const [blocks, setBlocks] = useState<ScheduleBlockDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (venueBootstrap) {
      setOpeningHours(venueBootstrap.openingHours);
      setVenueTimezone(venueBootstrap.timezone);
      return;
    }
    void fetch('/api/venue')
      .then((r) => (r.ok ? r.json() : null))
      .then((v) => {
        if (v?.opening_hours) setOpeningHours(v.opening_hours as OpeningHours);
        const tz = v?.timezone;
        if (typeof tz === 'string' && tz.trim() !== '') setVenueTimezone(tz.trim());
      })
      .catch((e) => console.error('[StaffScheduleMergedDayGrid] /api/venue preload failed:', e));
  }, [venueBootstrap]);

  useEffect(() => {
    let cancelled = false;
    setBlocks([]);
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const res = await fetch(`/api/venue/schedule?date=${encodeURIComponent(date)}`);
        if (!res.ok) throw new Error('Failed to load schedule');
        const j = (await res.json()) as { blocks?: ScheduleBlockDTO[] };
        if (!cancelled) setBlocks(j.blocks ?? []);
      } catch {
        if (!cancelled) {
          setError('Could not load schedule for this date.');
          setBlocks([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [date]);

  useEffect(() => {
    const root = gridScrollRef.current;
    if (!root) return;

    const onWheel = (e: WheelEvent) => {
      const main = root.closest('main');
      if (!main) return;
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        main.scrollLeft += e.deltaX;
        e.preventDefault();
        return;
      }
      if (e.deltaY !== 0) {
        main.scrollBy({ top: e.deltaY });
        e.preventDefault();
      }
    };

    root.addEventListener('wheel', onWheel, { passive: false });
    return () => root.removeEventListener('wheel', onWheel);
  }, []);

  const { startHour, endHour } = useMemo(
    () => getCalendarGridBounds(date, openingHours ?? undefined, 7, 21, { timeZone: venueTimezone }),
    [date, openingHours, venueTimezone],
  );

  const showEvents = venueExposesBookingModel(bookingModel, enabledModels, 'event_ticket');
  const showResources = venueExposesBookingModel(bookingModel, enabledModels, 'resource_booking');
  /** Class sessions use team calendar columns in `PractitionerCalendarView`; this feed is events + resources only. */
  const showMerged = showEvents || showResources;

  const onBookingClick = useCallback(
    (bookingId: string) => {
      router.push(`/dashboard/bookings?openBooking=${encodeURIComponent(bookingId)}`);
    },
    [router],
  );

  const totalSlots = ((endHour - startHour) * 60) / SLOT_MINUTES;
  const timeLabels = useMemo(
    () =>
      Array.from({ length: totalSlots + 1 }, (_, i) => {
        const mins = startHour * 60 + i * SLOT_MINUTES;
        return minutesToTime(mins);
      }),
    [startHour, totalSlots],
  );

  if (!showMerged) return null;

  const dayBlocks = blocks.filter((b) => b.date === date && b.kind !== 'class_session');
  const hasAnyBlock = dayBlocks.length > 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
        <span className="font-semibold text-slate-800">Events & resources</span>
        {showEvents && (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-4 rounded bg-violet-500" aria-hidden />
            Events
          </span>
        )}
        {showResources && (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-4 rounded bg-slate-500" aria-hidden />
            Resources
          </span>
        )}
      </div>

      {error && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{error}</p>
      )}

      {loading && !hasAnyBlock ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white py-12 text-sm text-slate-500">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
          Loading schedule…
        </div>
      ) : (
        <div
          ref={gridScrollRef}
          className="w-full touch-manipulation overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-900/5 [-webkit-overflow-scrolling:touch]"
        >
          <div className="flex min-w-full">
            <div className="w-14 flex-shrink-0 border-r border-slate-100 bg-slate-50 sm:w-16">
              <div className="h-10 border-b border-slate-100" />
              <div className="relative" style={{ height: totalSlots * SLOT_HEIGHT }}>
                {timeLabels.map((t, i) =>
                  i % 4 === 0 ? (
                    <div
                      key={`${t}-${i}`}
                      className="absolute left-0 w-full pr-2 text-right text-xs text-slate-400"
                      style={{ top: i * SLOT_HEIGHT - 6 }}
                    >
                      {t}
                    </div>
                  ) : null,
                )}
              </div>
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              <div
                className="sticky top-0 z-20 flex w-full divide-x divide-slate-100 border-b border-slate-200 border-l border-slate-100 bg-white shadow-sm"
                role="row"
                aria-label="Schedule columns"
              >
                {showEvents ? (
                  <div className="flex h-12 min-w-[min(16rem,calc(100vw-5.5rem))] flex-1 items-center justify-center px-3 sm:min-w-[240px]">
                    <span className="truncate text-center text-sm font-semibold text-slate-900">Events</span>
                  </div>
                ) : null}
                {showResources ? (
                  <div className="flex h-12 min-w-[min(16rem,calc(100vw-5.5rem))] flex-1 items-center justify-center px-3 sm:min-w-[240px]">
                    <span className="truncate text-center text-sm font-semibold text-slate-900">Resources</span>
                  </div>
                ) : null}
              </div>
              <div className="flex w-full min-w-0 border-l border-slate-100">
                {showEvents ? (
                  <ScheduleFeedColumn
                    label="Events"
                    date={date}
                    blocks={blocks.filter((b) => b.kind === 'event_ticket')}
                    startHour={startHour}
                    endHour={endHour}
                    slotHeightPx={SLOT_HEIGHT}
                    onBookingClick={onBookingClick}
                    hideHeader
                  />
                ) : null}
                {showResources ? (
                  <ScheduleFeedColumn
                    label="Resources"
                    date={date}
                    blocks={blocks.filter((b) => b.kind === 'resource_booking')}
                    startHour={startHour}
                    endHour={endHour}
                    slotHeightPx={SLOT_HEIGHT}
                    onBookingClick={onBookingClick}
                    hideHeader
                  />
                ) : null}
              </div>
            </div>
          </div>
        </div>
      )}

      {!loading && !error && !hasAnyBlock && (
        <p className="text-sm text-slate-500">
          No ticketed events or resource bookings on this day. Class sessions appear on the team calendar when
          unified scheduling is enabled. Use the shortcuts above to manage catalogue.
        </p>
      )}
    </div>
  );
}
