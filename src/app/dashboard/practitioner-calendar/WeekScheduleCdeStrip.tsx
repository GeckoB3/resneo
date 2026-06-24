'use client';

import Link from 'next/link';
import { formatEventUptakeLine } from '@/lib/calendar/event-block-label';
import type { ScheduleBlockDTO } from '@/types/schedule-blocks';

interface Props {
  weekDays: string[];
  blocksByDate: Map<string, ScheduleBlockDTO[]>;
  onBookingClick: (bookingId: string, anchor: { x: number; y: number }) => void;
  onClassInstanceClick?: (block: ScheduleBlockDTO, anchor: { x: number; y: number }) => void;
  onEventInstanceClick?: (block: ScheduleBlockDTO) => void;
  onResourceBookingClick?: (block: ScheduleBlockDTO, anchor: { x: number; y: number }) => void;
}

/**
 * Shared row under the practitioner week grid: compact chips for events (ScheduleBlock feed).
 */
export function WeekScheduleCdeStrip({
  weekDays,
  blocksByDate,
  onBookingClick,
  onClassInstanceClick,
  onEventInstanceClick,
  onResourceBookingClick,
}: Props) {
  return (
    <tr className="border-t border-slate-200 bg-slate-50/80">
      <td className="sticky left-0 z-10 bg-slate-50 px-3 py-2 align-top text-xs font-semibold text-slate-600">
        Events &amp; resources
      </td>
      {weekDays.map((d) => {
        const dayBlocks = (blocksByDate.get(d) ?? []).filter((b) => b.status !== 'Cancelled');
        return (
          <td key={d} className="align-top px-1 py-2">
            <div className="flex min-h-[80px] max-h-[200px] flex-col gap-1 overflow-y-auto">
              {dayBlocks.length === 0 ? (
                <span className="select-none py-1 text-center text-[11px] italic text-slate-300">
                  None
                </span>
              ) : (
                dayBlocks.map((b) => {
                  const emptyEvent =
                    b.kind === 'event_ticket' &&
                    b.experience_event_id &&
                    (b.event_booking_count ?? (b.booking_id ? 1 : 0)) === 0;
                  const shell =
                    b.kind === 'event_ticket' && b.experience_event_id
                      ? emptyEvent
                      : !b.booking_id;
                  const accent = b.accent_colour ?? '#64748B';
                  const classUptake =
                    b.kind === 'class_session' &&
                    b.class_capacity != null &&
                    b.class_booked_spots != null
                      ? `${b.class_booked_spots}/${b.class_capacity} booked`
                      : null;
                  const eventUptake = b.kind === 'event_ticket' ? formatEventUptakeLine(b) : null;
                  const body = (
                    <div
                      className={`rounded border px-1.5 py-1 text-left text-[11px] leading-snug shadow-sm ${
                        shell ? 'border-dashed border-slate-300 bg-white/80' : 'border-slate-200 bg-white'
                      }`}
                      style={{ borderLeftWidth: 3, borderLeftColor: accent }}
                    >
                      <div className="truncate font-semibold text-slate-900">{b.title}</div>
                      {eventUptake ? (
                        <div className="truncate text-slate-600">{eventUptake}</div>
                      ) : b.subtitle ? (
                        <div className="truncate text-slate-500">{b.subtitle}</div>
                      ) : null}
                      {classUptake ? (
                        <div className="truncate font-medium text-slate-600">{classUptake}</div>
                      ) : null}
                      <div className="text-slate-500">
                        {b.start_time.slice(0, 5)}–{b.end_time.slice(0, 5)}
                      </div>
                    </div>
                  );
                  if (b.kind === 'event_ticket' && b.experience_event_id && onEventInstanceClick) {
                    return (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => onEventInstanceClick(b)}
                        className="block w-full text-left"
                      >
                        {body}
                      </button>
                    );
                  }
                  if (b.kind === 'resource_booking' && b.booking_id && b.resource_id && onResourceBookingClick) {
                    return (
                      <button
                        key={b.id}
                        type="button"
                        onClick={(e) => onResourceBookingClick(b, { x: e.clientX, y: e.clientY })}
                        className="block w-full text-left"
                      >
                        {body}
                      </button>
                    );
                  }
                  if (b.booking_id) {
                    return (
                      <button
                        key={b.id}
                        type="button"
                        onClick={(e) => onBookingClick(b.booking_id!, { x: e.clientX, y: e.clientY })}
                        className="block w-full text-left"
                      >
                        {body}
                      </button>
                    );
                  }
                  if (b.kind === 'event_ticket') {
                    return (
                      <Link key={b.id} href="/dashboard/event-manager" className="block">
                        {body}
                      </Link>
                    );
                  }
                  if (b.kind === 'class_session' && b.class_instance_id && onClassInstanceClick) {
                    return (
                      <button
                        key={b.id}
                        type="button"
                        onClick={(e) => onClassInstanceClick(b, { x: e.clientX, y: e.clientY })}
                        className="block w-full text-left"
                      >
                        {body}
                      </button>
                    );
                  }
                  if (b.kind === 'class_session') {
                    return (
                      <Link key={b.id} href="/dashboard/class-timetable" className="block">
                        {body}
                      </Link>
                    );
                  }
                  if (b.kind === 'resource_booking') {
                    return (
                      <Link key={b.id} href="/dashboard/resource-timeline" className="block">
                        {body}
                      </Link>
                    );
                  }
                  return (
                    <div key={b.id} className="block">
                      {body}
                    </div>
                  );
                })
              )}
            </div>
          </td>
        );
      })}
    </tr>
  );
}
