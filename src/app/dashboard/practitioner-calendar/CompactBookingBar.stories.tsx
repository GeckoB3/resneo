import type { Story } from '@ladle/react';
import {
  bookingCalendarBlockPalette,
  bookingCalendarBlockCardStyle,
  CalendarBookingStatusStripe,
  type BookingCalendarBlockInput,
} from '@/lib/calendar/booking-calendar-block-style';
import { BookingCard } from './BookingCard';
import { CompactBookingActions } from './CompactBookingActions';

/**
 * Visual harness for the compact day-view booking bars. Reproduces the real bar assembly
 * (palette + stripe + name + horizontal action row) at the heights compact mode produces,
 * so the name-legibility and button-fit can be verified without an authenticated dashboard.
 */

const HEIGHTS = [16, 18, 20, 24, 28, 32, 40, 48];
const COLUMN_WIDTH = 240;

function CompactBar({
  height,
  status,
  arrived = false,
  name = 'Sarah Mitchell',
  widthPx = COLUMN_WIDTH,
  narrow = false,
}: {
  height: number;
  status: string;
  arrived?: boolean;
  name?: string;
  widthPx?: number;
  narrow?: boolean;
}) {
  const input = { status, client_arrived_at: arrived ? '2020-01-01T09:00:00Z' : null } as BookingCalendarBlockInput;
  const palette = bookingCalendarBlockPalette(input);
  const cardStyle = bookingCalendarBlockCardStyle(palette);
  // Mirror the real bar chrome so the measured available width matches: 4px stripe + drag grip
  // (18px normal, 9px in overlap lanes).
  const gripPx = narrow ? 9 : 18;
  const availableWidthPx = widthPx - 4 - gripPx;
  return (
    <div
      className="relative flex flex-row items-center overflow-hidden rounded-2xl shadow-sm ring-1 ring-white/70"
      style={{ height, width: widthPx, ...cardStyle }}
    >
      <CalendarBookingStatusStripe palette={palette} />
      <div className="shrink-0 self-stretch bg-black/[0.04]" style={{ width: gripPx }} aria-hidden />
      <div className="relative z-[1] flex min-h-0 min-w-0 flex-1 flex-row items-center">
        <div className="flex min-w-0 flex-1 self-stretch overflow-hidden">
          <div className="flex h-full w-full flex-col justify-center overflow-hidden px-2.5 py-0 text-left">
            <BookingCard
              name={name}
              service="Cut & colour"
              phone="07700 900123"
              start="09:00"
              end="09:15"
              pill={null}
              contentHeightPx={height}
              density="compact"
              actionsReservePx={0}
            />
          </div>
        </div>
        <CompactBookingActions
          booking={{ id: 'demo', status, client_arrived_at: arrived ? '2020-01-01T09:00:00Z' : null }}
          busy={false}
          barHeightPx={height}
          availableWidthPx={availableWidthPx}
          narrow={narrow}
          onStatus={() => {}}
          onArrived={() => {}}
        />
      </div>
    </div>
  );
}

function StatusColumn({ status, arrived, label }: { status: string; arrived?: boolean; label: string }) {
  return (
    <div className="flex flex-col gap-2" style={{ width: COLUMN_WIDTH + 40 }}>
      <div className="text-xs font-semibold text-slate-700">{label}</div>
      {HEIGHTS.map((h) => (
        <div key={h} className="flex items-center gap-2">
          <span className="w-9 shrink-0 text-right text-[10px] tabular-nums text-slate-400">{h}px</span>
          <CompactBar height={h} status={status} arrived={arrived} />
        </div>
      ))}
    </div>
  );
}

export const CompactBars: Story = () => (
  <div className="flex flex-wrap gap-6 bg-slate-100 p-6">
    <StatusColumn status="Pending" label="Pending — Arrived + Confirm" />
    <StatusColumn status="Confirmed" label="Confirmed — Arrived + Start" />
    <StatusColumn status="Confirmed" arrived label="Confirmed (arrived) — Clear + Start" />
    <StatusColumn status="Seated" label="Seated — Undo + Complete" />
    <StatusColumn status="Completed" label="Completed — Reopen" />
  </div>
);

export const NarrowOverlapLanes: Story = () => (
  <div className="flex flex-wrap gap-6 bg-slate-100 p-6">
    {[120, 100, 80].map((w) => (
      <div key={w} className="flex flex-col gap-2" style={{ width: w + 40 }}>
        <div className="text-xs font-semibold text-slate-700">{w}px lane (narrow)</div>
        {HEIGHTS.map((h) => (
          <div key={h} className="flex items-center gap-2">
            <span className="w-9 shrink-0 text-right text-[10px] tabular-nums text-slate-400">{h}px</span>
            <CompactBar height={h} status="Pending" widthPx={w} narrow name="Sarah Mitchell" />
          </div>
        ))}
      </div>
    ))}
  </div>
);

export const LongName: Story = () => (
  <div className="flex flex-wrap gap-6 bg-slate-100 p-6">
    <div className="flex flex-col gap-2" style={{ width: COLUMN_WIDTH + 40 }}>
      <div className="text-xs font-semibold text-slate-700">Long name truncation</div>
      {HEIGHTS.map((h) => (
        <div key={h} className="flex items-center gap-2">
          <span className="w-9 shrink-0 text-right text-[10px] tabular-nums text-slate-400">{h}px</span>
          <CompactBar height={h} status="Seated" name="Alexandra Featherstone-Worthington" />
        </div>
      ))}
    </div>
  </div>
);
