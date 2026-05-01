'use client';

import { useCallback, useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { CalendarDateTimePicker } from '@/components/calendar/CalendarDateTimePicker';
import { ClampedFixedDropdown } from '@/components/ui/ClampedFixedDropdown';
import { OperationsWorkspaceToolbar } from '@/components/dashboard/OperationsWorkspaceToolbar';
import type { ViewToolbarSummary } from '@/components/dashboard/ViewToolbar';

export type CalendarToolbarViewMode = 'day' | 'week' | 'month';

export interface PractitionerCalendarToolbarProps {
  viewMode: CalendarToolbarViewMode;
  onViewModeChange: (m: CalendarToolbarViewMode) => void;
  onNavigateDay: (delta: 1 | -1) => void;
  onDateChange: (date: string) => void;
  date: string;
  weekStart: string;
  monthAnchor: string;
  startHour: number;
  endHour: number;
  onTimeRangeChange: (start: number, end: number) => void;
  onRefresh: () => void;
  onNewBooking: () => void;
  onWalkIn: () => void;
  controlsPanel: ReactNode;
  controlsLabel?: string;
  summaryContent: ReactNode;
}

const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const VIEW_MODE_OPTIONS: { id: CalendarToolbarViewMode; label: string }[] = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
];

function addDays(date: string, days: number): string {
  const d = new Date(date + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function startOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

function formatCalendarPeriodLabel(
  viewMode: CalendarToolbarViewMode,
  date: string,
  weekStart: string,
  monthAnchor: string,
): string {
  if (viewMode === 'day') {
    const d = new Date(date + 'T12:00:00');
    return `${WEEKDAYS_LONG[d.getDay()]} ${d.getDate()} ${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`;
  }
  if (viewMode === 'week') {
    const d = new Date(weekStart + 'T12:00:00');
    const end = new Date(addDays(weekStart, 6) + 'T12:00:00');
    return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} – ${end.getDate()} ${MONTHS_SHORT[end.getMonth()]} ${end.getFullYear()}`;
  }
  const d = new Date(`${startOfMonth(monthAnchor)}T12:00:00`);
  return `${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * Calendar toolbar using the shared compact operations chrome.
 */
export function PractitionerCalendarToolbar({
  viewMode,
  onViewModeChange,
  onNavigateDay,
  onDateChange,
  date,
  weekStart,
  monthAnchor,
  startHour,
  endHour,
  onTimeRangeChange,
  onRefresh,
  onNewBooking,
  onWalkIn,
  controlsPanel,
  controlsLabel = 'Filter',
  summaryContent,
}: PractitionerCalendarToolbarProps) {
  const periodLabel = formatCalendarPeriodLabel(viewMode, date, weekStart, monthAnchor);
  const viewModePanelId = useId();
  const viewModeTriggerRef = useRef<HTMLButtonElement>(null);
  const viewModeWrapRef = useRef<HTMLDivElement>(null);
  const [viewModePopoverOpen, setViewModePopoverOpen] = useState(false);
  const toolbarSummary: ViewToolbarSummary = {
    total_covers_booked: 0,
    total_covers_capacity: 0,
    tables_in_use: 0,
    tables_total: 0,
    unassigned_count: 0,
    combos_in_use: 0,
  };

  useEffect(() => {
    if (!viewModePopoverOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setViewModePopoverOpen(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (viewModeWrapRef.current?.contains(target)) return;
      setViewModePopoverOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [viewModePopoverOpen]);

  const viewModeSwitcher = useCallback(
    (toolbarPanelAnchorRef: RefObject<HTMLDivElement | null>) => (
      <div ref={viewModeWrapRef} className="relative shrink-0">
        <button
          ref={viewModeTriggerRef}
          type="button"
          onClick={() => setViewModePopoverOpen((openNow) => !openNow)}
          className={`inline-flex min-h-8 shrink-0 items-center gap-0.5 rounded-lg border px-2 py-1 text-[11px] font-semibold shadow-sm hover:bg-slate-50 sm:text-xs ${
            viewModePopoverOpen
              ? 'border-brand-300 bg-brand-50 text-brand-800 ring-1 ring-brand-200'
              : 'border-slate-200 bg-white text-slate-700'
          }`}
          aria-expanded={viewModePopoverOpen}
          aria-haspopup="dialog"
          aria-controls={viewModePanelId}
          aria-label="View - Day, week, or month"
        >
          <span className="max-w-[4.75rem] truncate sm:max-w-none">
            {VIEW_MODE_OPTIONS.find((option) => option.id === viewMode)?.label ?? 'Day'}
          </span>
          <svg className="h-3.5 w-3.5 shrink-0 text-slate-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
          </svg>
        </button>
        <ClampedFixedDropdown
          open={viewModePopoverOpen}
          triggerRef={viewModeTriggerRef}
          verticalAnchorRef={toolbarPanelAnchorRef}
          horizontalCenter
          gapPx={4}
          align="start"
          maxWidthPx={240}
          id={viewModePanelId}
          aria-label="Choose calendar view"
          className="animate-fade-in z-50 overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl shadow-slate-900/10 ring-1 ring-slate-100"
        >
          <p className="px-2 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">View</p>
          <div role="radiogroup" aria-label="Calendar view" className="space-y-0.5">
            {VIEW_MODE_OPTIONS.map(({ id: modeId, label }) => (
              <button
                key={modeId}
                type="button"
                role="radio"
                aria-checked={viewMode === modeId}
                onClick={() => {
                  onViewModeChange(modeId);
                  setViewModePopoverOpen(false);
                }}
                className={`flex w-full items-center rounded-lg px-2.5 py-2 text-left text-sm font-semibold ${
                  viewMode === modeId
                    ? 'bg-brand-50 text-brand-800 ring-1 ring-brand-200'
                    : 'text-slate-800 hover:bg-slate-50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </ClampedFixedDropdown>
      </div>
    ),
    [onViewModeChange, viewMode, viewModePanelId, viewModePopoverOpen],
  );

  const datePickerPanel = (
    <div className="rounded-xl border border-slate-200 bg-white p-2.5 shadow-sm sm:p-3">
      <CalendarDateTimePicker
        date={date}
        onDateChange={onDateChange}
        startHour={startHour}
        endHour={endHour}
        onTimeRangeChange={onTimeRangeChange}
      />
    </div>
  );

  const timeRangePanel = (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Visible time range</p>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">From</span>
          <select
            value={startHour}
            onChange={(e) => onTimeRangeChange(Number(e.target.value), endHour)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          >
            {Array.from({ length: 23 }, (_, h) => h).map((h) => (
              <option key={h} value={h} disabled={h >= endHour}>
                {String(h).padStart(2, '0')}:00
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Until</span>
          <select
            value={endHour}
            onChange={(e) => onTimeRangeChange(startHour, Number(e.target.value))}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          >
            {Array.from({ length: 24 }, (_, i) => i + 1).map((h) => (
              <option key={h} value={h} disabled={h <= startHour}>
                {String(h).padStart(2, '0')}:00
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );

  return (
    <OperationsWorkspaceToolbar
      title="Calendar"
      summary={toolbarSummary}
      summaryContent={summaryContent}
      date={date}
      dateLabel={periodLabel}
      onDateChange={onDateChange}
      onPreviousDate={() => onNavigateDay(-1)}
      onNextDate={() => onNavigateDay(1)}
      liveState="live"
      onRefresh={onRefresh}
      onNewBooking={onNewBooking}
      onWalkIn={onWalkIn}
      datePickerPanel={datePickerPanel}
      timelinePanel={timeRangePanel}
      timelineLabel={`${String(startHour).padStart(2, '0')}:00-${String(endHour).padStart(2, '0')}:00`}
      controlsPanel={controlsPanel}
      controlsLabel={controlsLabel}
      compact
      toolbarLeadingTools={viewModeSwitcher}
    />
  );
}
