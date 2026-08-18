'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { BookingModel } from '@/types/booking-models';
import { StaffScheduleMergedDayGrid } from '@/components/calendar/StaffScheduleMergedDayGrid';
import { CalendarDateTimePicker } from '@/components/calendar/CalendarDateTimePicker';
import { getCalendarGridBounds } from '@/lib/venue-calendar-bounds';
import { useVenueWideBlocks } from '@/lib/hooks/use-venue-wide-blocks';
import type { OpeningHours } from '@/types/availability';
import { PageFrame } from '@/components/ui/dashboard/PageFrame';
import { PageHeader } from '@/components/ui/dashboard/PageHeader';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import { useDashboardVenueBootstrap } from '@/components/providers/DashboardVenueBootstrapProvider';


interface Props {
  bookingModel: BookingModel;
  enabledModels: BookingModel[];
}

/**
 * Legacy schedule hub (shortcuts + merged day grid). `/dashboard/calendar` now always uses
 * {@link PractitionerCalendarView} for schedule-eligible venues; keep this module for any future
 * embedded hub or reuse of the merged grid outside the main calendar route.
 */
export function StaffScheduleHub({ bookingModel, enabledModels }: Props) {
  const venueBootstrap = useDashboardVenueBootstrap();
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [fetchedOpeningHours, setFetchedOpeningHours] = useState<OpeningHours | null>(null);
  const [fetchedVenueTimezone, setFetchedVenueTimezone] = useState<string>('Europe/London');
  const [startHourOverride, setStartHourOverride] = useState<number | null>(null);
  const [endHourOverride, setEndHourOverride] = useState<number | null>(null);

  const openingHours = venueBootstrap?.openingHours ?? fetchedOpeningHours;
  const venueTimezone = venueBootstrap?.timezone ?? fetchedVenueTimezone;
  const venueWideBlocks = useVenueWideBlocks();

  useEffect(() => {
    if (venueBootstrap) return;
    void fetch('/api/venue')
      .then((r) => (r.ok ? r.json() : null))
      .then((v) => {
        if (v?.opening_hours) setFetchedOpeningHours(v.opening_hours as OpeningHours);
        const tz = v?.timezone;
        if (typeof tz === 'string' && tz.trim() !== '') setFetchedVenueTimezone(tz.trim());
      })
      .catch((e) => console.error('[StaffScheduleHub] /api/venue preload failed:', e));
  }, [venueBootstrap]);

  const { startHour: derivedStart, endHour: derivedEnd } = useMemo(
    () => getCalendarGridBounds(date, openingHours ?? undefined, 7, 21, { timeZone: venueTimezone, venueWideBlocks }),
    [date, openingHours, venueTimezone, venueWideBlocks],
  );
  const startHour = startHourOverride ?? derivedStart;
  const endHour = endHourOverride ?? derivedEnd;

  const active = useMemo(() => new Set<BookingModel>([bookingModel, ...enabledModels]), [bookingModel, enabledModels]);
  const showAppointments = active.has('unified_scheduling') && bookingModel !== 'unified_scheduling';
  const showEvents = active.has('event_ticket');
  const showClasses = active.has('class_session');
  const showResources = active.has('resource_booking');
  const hubSubtitle =
    bookingModel === 'table_reservation' ? (
      <>
        Table reservations and live floor layout use{' '}
        <Link href="/dashboard/day-sheet" className="font-medium text-brand-700 underline underline-offset-2">
          Day sheet
        </Link>{' '}
        and{' '}
        <Link href="/dashboard/floor-plan" className="font-medium text-brand-700 underline underline-offset-2">
          Floor plan
        </Link>
        . This page focuses on appointments, events, classes, and resources when enabled.
      </>
    ) : (
      <>
        Open each area below for full management. The day grid shows ticketed events, class instances, and resource
        bookings, not table reservations.
      </>
    );

  return (
    <PageFrame>
      <div className="flex min-h-0 flex-col space-y-8">
        <PageHeader eyebrow="Operations" title="Schedule" subtitle={hubSubtitle} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {showAppointments && (
          <Link
            href="/dashboard/appointment-services"
            className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-900/5 transition hover:border-brand-200 hover:shadow-lg hover:shadow-slate-900/10"
          >
            <p className="text-sm font-semibold text-slate-900">Appointments &amp; services</p>
            <p className="mt-1 text-xs text-slate-500">Manage calendars, services, and appointment bookings</p>
          </Link>
        )}
        {showEvents && (
          <Link
            href="/dashboard/event-manager"
            className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-900/5 transition hover:border-brand-200 hover:shadow-lg hover:shadow-slate-900/10"
          >
            <p className="text-sm font-semibold text-slate-900">Events (tickets)</p>
            <p className="mt-1 text-xs text-slate-500">Ticketed events, capacity, and guest bookings</p>
          </Link>
        )}
        {showClasses && (
          <Link
            href="/dashboard/class-timetable"
            className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-900/5 transition hover:border-brand-200 hover:shadow-lg hover:shadow-slate-900/10"
          >
            <p className="text-sm font-semibold text-slate-900">Class timetable</p>
            <p className="mt-1 text-xs text-slate-500">Instances, roster, and cancellations</p>
          </Link>
        )}
        {showResources && (
          <Link
            href="/dashboard/resource-timeline"
            className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-900/5 transition hover:border-brand-200 hover:shadow-lg hover:shadow-slate-900/10"
          >
            <p className="text-sm font-semibold text-slate-900">Resources</p>
            <p className="mt-1 text-xs text-slate-500">Dedicated resource timeline and settings</p>
          </Link>
        )}
      </div>

      {(showEvents || showResources) && (
        <SectionCard elevated>
          <SectionCard.Header eyebrow="Day view" title="Merged schedule" description="Events and resource bookings for the selected day." />
          <SectionCard.Body className="space-y-4">
            <CalendarDateTimePicker
              date={date}
              onDateChange={(next) => {
                setStartHourOverride(null);
                setEndHourOverride(null);
                setDate(next);
              }}
              startHour={startHour}
              endHour={endHour}
              onTimeRangeChange={(s, e) => {
                setStartHourOverride(s);
                setEndHourOverride(e);
              }}
            />
            <StaffScheduleMergedDayGrid date={date} bookingModel={bookingModel} enabledModels={enabledModels} />
          </SectionCard.Body>
        </SectionCard>
      )}
      </div>
    </PageFrame>
  );
}
