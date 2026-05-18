'use client';

import Link from 'next/link';
import { formatEventUptakeLine } from '@/lib/calendar/event-block-label';
import type { ScheduleBlockDTO } from '@/types/schedule-blocks';

const SLOT_HEIGHT = 48;
const SLOT_MINUTES = 15;

/** Matches Confirmed (indigo) lane styling next to practitioner calendar booking blocks. */
const CLASS_LANE_BG = 'bg-indigo-100';
const CLASS_LANE_BORDER = 'border-indigo-400';
const CLASS_LANE_TEXT = 'text-indigo-950';

function timeToMinutes(t: string): number {
  const [hh, mm] = t.slice(0, 5).split(':').map(Number);
  return (hh ?? 0) * 60 + (mm ?? 0);
}

function feedGridLineClass(minutes: number): string {
  if (minutes % 60 === 0) return 'border-t-slate-400';
  if (minutes % 30 === 0) return 'border-t-slate-300';
  return 'border-t-slate-100';
}

function feedSlotBandClass(minutes: number): string {
  const slotIndex = Math.max(0, Math.floor(minutes / SLOT_MINUTES));
  return slotIndex % 2 === 1 ? 'bg-slate-50/55' : 'bg-white';
}

interface ScheduleFeedColumnProps {
  label: string;
  date: string;
  blocks: ScheduleBlockDTO[];
  startHour: number;
  endHour: number;
  onBookingClick: (bookingId: string, anchor: { x: number; y: number }) => void;
  /** When set, class session blocks open this handler (full session roster) instead of a single booking. */
  onClassInstanceClick?: (block: ScheduleBlockDTO, anchor: { x: number; y: number }) => void;
  /** When set, experience event aggregate blocks open this handler (roster + event detail). */
  onEventInstanceClick?: (block: ScheduleBlockDTO) => void;
  /** Omit the top label row when the parent renders a unified sticky header (day grid). */
  hideHeader?: boolean;
}

/**
 * Single lane column (Events / Classes / Resources) aligned to the practitioner day grid.
 */
export function ScheduleFeedColumn({
  label,
  date,
  blocks,
  startHour,
  endHour,
  onBookingClick,
  onClassInstanceClick,
  onEventInstanceClick,
  hideHeader = false,
}: ScheduleFeedColumnProps) {
  const totalSlots = (() => {
    const n = ((endHour - startHour) * 60) / SLOT_MINUTES;
    return Number.isFinite(n) && n > 0 ? n : ((21 - 7) * 60) / SLOT_MINUTES;
  })();

  function slotTop(time: string): number {
    const mins = timeToMinutes(time);
    const offset = mins - startHour * 60;
    return (offset / SLOT_MINUTES) * SLOT_HEIGHT;
  }

  function slotHeight(start: string, end: string): number {
    const d = Math.max(timeToMinutes(end) - timeToMinutes(start), SLOT_MINUTES);
    return Math.max((d / SLOT_MINUTES) * SLOT_HEIGHT, SLOT_HEIGHT * 0.75);
  }

  const dayBlocks = blocks.filter((b) => b.date === date);

  return (
    <div className="min-w-[min(16rem,calc(100vw-5.5rem))] flex-1 border-r border-slate-300 last:border-r-0 sm:min-w-[240px]">
      {!hideHeader ? (
        <div className="sticky top-0 z-10 flex h-10 items-center justify-center border-b border-slate-300 bg-gradient-to-br from-white via-slate-50 to-slate-100/90 px-3 py-2 shadow-sm shadow-slate-900/5">
          <span className="truncate text-center text-sm font-semibold text-slate-900">{label}</span>
        </div>
      ) : null}
      <div className="relative" style={{ height: totalSlots * SLOT_HEIGHT }}>
        {Array.from({ length: totalSlots + 1 }, (_, i) => {
          const slotStartMins = startHour * 60 + i * SLOT_MINUTES;
          return (
            <div
              key={`grid-${i}`}
              className={`absolute left-0 right-0 z-[1] border-t ${feedGridLineClass(slotStartMins)}`}
              style={{ top: i * SLOT_HEIGHT }}
            />
          );
        })}
        {Array.from({ length: totalSlots }, (_, i) => {
          const slotStartMins = startHour * 60 + i * SLOT_MINUTES;
          return (
            <div
              key={`band-${i}`}
              className={`absolute left-0 right-0 z-0 ${feedSlotBandClass(slotStartMins)}`}
              style={{ top: i * SLOT_HEIGHT, height: SLOT_HEIGHT }}
            />
          );
        })}
        {dayBlocks.map((b) => {
          const top = slotTop(b.start_time);
          const height = slotHeight(b.start_time, b.end_time);
          const accent = b.accent_colour ?? '#64748B';
          const eventUptake = b.kind === 'event_ticket' ? formatEventUptakeLine(b) : null;
          const eventOpensDetail =
            b.kind === 'event_ticket' && b.experience_event_id && typeof onEventInstanceClick === 'function';
          const clickable =
            Boolean(b.booking_id) || Boolean(eventOpensDetail);
          const classUptake =
            b.kind === 'class_session' &&
            b.class_capacity != null &&
            b.class_booked_spots != null
              ? `${b.class_booked_spots}/${b.class_capacity} booked`
              : null;
          const isClass = b.kind === 'class_session';
          const cardClass = isClass
            ? `flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border shadow-sm ring-1 ring-white/70 ${CLASS_LANE_BG} ${CLASS_LANE_BORDER} px-3 py-2 text-left transition-all hover:-translate-y-0.5 hover:shadow-xl hover:shadow-slate-900/12`
            : `flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 px-3 py-2 text-left shadow-sm ring-1 ring-white/70 transition-all hover:-translate-y-0.5 hover:shadow-xl hover:shadow-slate-900/12`;
          const body = (
            <div
              className={`${cardClass} ${clickable ? 'cursor-pointer hover:brightness-[0.98]' : ''}`}
              style={{ borderLeftWidth: 3, borderLeftColor: accent }}
            >
              <span className={`truncate text-[13px] font-extrabold tracking-tight ${isClass ? CLASS_LANE_TEXT : 'text-slate-900'}`}>
                {b.title}
              </span>
              {b.kind === 'event_ticket' ? (
                eventUptake ? (
                  <span className="truncate text-[10px] font-medium text-slate-600">{eventUptake}</span>
                ) : null
              ) : b.subtitle ? (
                <span className={`truncate text-[10px] ${isClass ? 'text-blue-800/90' : 'text-slate-500'}`}>
                  {b.subtitle}
                </span>
              ) : null}
              {classUptake ? (
                <span className={`truncate text-[10px] font-medium ${isClass ? 'text-blue-800' : 'text-slate-600'}`}>
                  {classUptake}
                </span>
              ) : null}
                <span className={`mt-auto rounded-full bg-white/60 px-1.5 py-0.5 text-[10px] font-bold tabular-nums shadow-sm ring-1 ring-black/5 ${isClass ? 'text-blue-700/80' : 'text-slate-500'}`}>
                {b.start_time} – {b.end_time}
              </span>
            </div>
          );

          const classOpensRoster =
            b.kind === 'class_session' && b.class_instance_id && typeof onClassInstanceClick === 'function';

          return (
            <div key={b.id} className="absolute left-1 right-1 z-[12]" style={{ top, height }}>
              {classOpensRoster ? (
                <button
                  type="button"
                  onClick={(e) => onClassInstanceClick(b, { x: e.clientX, y: e.clientY })}
                  className="h-full w-full text-left"
                >
                  {body}
                </button>
              ) : eventOpensDetail ? (
                <button
                  type="button"
                  onClick={() => onEventInstanceClick!(b)}
                  className="h-full w-full text-left"
                >
                  {body}
                </button>
              ) : clickable && b.booking_id ? (
                <button
                  type="button"
                  onClick={(e) => onBookingClick(b.booking_id!, { x: e.clientX, y: e.clientY })}
                  className="h-full w-full text-left"
                >
                  {body}
                </button>
              ) : b.kind === 'event_ticket' && b.experience_event_id ? (
                <Link href="/dashboard/event-manager" className="block h-full">
                  {body}
                </Link>
              ) : b.kind === 'class_session' && b.class_instance_id ? (
                <Link href="/dashboard/class-timetable" className="block h-full">
                  {body}
                </Link>
              ) : (
                body
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
