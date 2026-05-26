'use client';

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import type { ViewToolbarSummary } from '@/components/dashboard/ViewToolbar';
import { CALENDAR_PICKER_SUBPOPOVER_SELECTOR } from '@/components/calendar/CalendarDateTimePicker';
import { ClampedFixedDropdown } from '@/components/ui/ClampedFixedDropdown';
import { isBookingDetailPopoverDismissExempt } from '@/lib/ui/booking-detail-popover-dismiss';
import { nextBookingsTileContent } from '@/lib/table-management/next-bookings-slot';

function formatDateInput(d: Date): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function shiftDate(isoDate: string, deltaDays: number): string {
  const base = new Date(`${isoDate}T00:00:00`);
  base.setDate(base.getDate() + deltaDays);
  return formatDateInput(base);
}

const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** Deterministic date label — avoids `toLocaleDateString` SSR/client ICU differences. */
function formatDateHeading(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00`);
  return `${WEEKDAYS_SHORT[d.getDay()]} ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

/** Fixed-width day strip so prev/next arrows stay put while the label changes. */
const DATE_NAV_GRID_CLASS_COMPACT = 'grid shrink-0 grid-cols-[2rem_9.75rem_2rem] items-center gap-1';
const DATE_NAV_GRID_CLASS_DEFAULT =
  'grid shrink-0 grid-cols-[2.5rem_11.25rem_2.5rem] items-center gap-1 sm:grid-cols-[2.25rem_11.25rem_2.25rem]';

function KpiChips({
  summary,
  onCoversChipClick,
  onUnassignedChipClick,
  onNextChipClick,
}: {
  summary: ViewToolbarSummary;
  onCoversChipClick?: () => void;
  onUnassignedChipClick?: () => void;
  onNextChipClick?: () => void;
}) {
  const useLiveCovers = typeof summary.covers_in_use_now === 'number';
  const coversShown = useLiveCovers ? summary.covers_in_use_now! : summary.total_covers_booked;
  const coversPct =
    summary.total_covers_capacity > 0
      ? Math.round((coversShown / summary.total_covers_capacity) * 100)
      : 0;
  const nextBookings =
    summary.next_bookings_slot !== undefined ? nextBookingsTileContent(summary.next_bookings_slot) : null;

  const chip =
    'inline-flex max-w-full items-center gap-1 rounded-md border border-slate-200/90 bg-slate-50 px-1.5 py-0.5 font-medium text-slate-800';
  const chipButton =
    `${chip} cursor-pointer text-left transition hover:border-slate-300 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1`;
  const label = 'text-slate-500 font-normal';

  return (
    <div className="flex flex-wrap items-center gap-1 text-[11px] sm:gap-1.5 sm:text-xs" aria-label="Shift summary">
      {onCoversChipClick ? (
        <button type="button" className={chipButton} onClick={onCoversChipClick} title="Open timeline — covers follow the service clock">
          <span className={label}>{useLiveCovers ? 'Live' : 'Booked'}</span>
          <span className="tabular-nums">
            {coversShown}/{summary.total_covers_capacity}
          </span>
          {summary.total_covers_capacity > 0 ? (
            <span className="text-slate-400">({coversPct}%)</span>
          ) : null}
        </button>
      ) : (
        <span className={chip} title={useLiveCovers ? 'Covers seated or in use at timeline' : 'Covers booked'}>
          <span className={label}>{useLiveCovers ? 'Live' : 'Booked'}</span>
          <span className="tabular-nums">
            {coversShown}/{summary.total_covers_capacity}
          </span>
          {summary.total_covers_capacity > 0 ? (
            <span className="text-slate-400">({coversPct}%)</span>
          ) : null}
        </span>
      )}
      <span className={chip}>
        <span className={label}>Tables</span>
        <span className="tabular-nums">
          {summary.tables_in_use}/{summary.tables_total}
        </span>
      </span>
      {onUnassignedChipClick ? (
        <button
          type="button"
          className={chipButton}
          onClick={onUnassignedChipClick}
          disabled={summary.unassigned_count === 0}
          title={summary.unassigned_count === 0 ? 'No unassigned bookings' : 'View unassigned bookings'}
        >
          <span className={label}>Unassigned</span>
          <span className="tabular-nums">{summary.unassigned_count}</span>
        </button>
      ) : (
        <span className={chip}>
          <span className={label}>Unassigned</span>
          <span className="tabular-nums">{summary.unassigned_count}</span>
        </span>
      )}
      {nextBookings !== null ? (
        onNextChipClick && summary.next_bookings_slot != null ? (
          <button
            type="button"
            className={chipButton}
            onClick={onNextChipClick}
            title={`${nextBookings.guestsLine}; ${nextBookings.bookingsLine}. Jump timeline to this arrival.`}
          >
            <span className={label}>Next</span>
            <span className="tabular-nums">{nextBookings.primaryValue}</span>
          </button>
        ) : (
          <span className={chip} title={`${nextBookings.guestsLine}; ${nextBookings.bookingsLine}`}>
            <span className={label}>Next</span>
            <span className="tabular-nums">{nextBookings.primaryValue}</span>
          </span>
        )
      ) : (
        <span className={chip}>
          <span className={label}>Combos</span>
          <span className="tabular-nums">{summary.combos_in_use ?? 0}</span>
        </span>
      )}
    </div>
  );
}

/** Matched New / Walk-in sizing in compact mode: icons only & square below `sm`; equal width with label from `sm` up; max width capped below legacy 8rem. */
const COMPACT_BOOKING_ACTION_LAYOUT =
  'inline-flex h-8 w-8 shrink-0 items-center justify-center gap-1 rounded-lg text-[11px] font-semibold text-white shadow-sm transition-colors sm:w-[5.15rem] sm:min-w-[5.15rem] sm:max-w-[5.15rem] sm:gap-1 sm:px-1.5';

function LiveStateIndicator({ state }: { state: 'live' | 'reconnecting' }) {
  const isLive = state === 'live';
  return (
    <span
      className={`inline-flex h-3 w-3 shrink-0 rounded-full ring-2 ring-white ${
        isLive ? 'bg-emerald-500' : 'bg-yellow-400'
      }`}
      role="status"
      aria-label={isLive ? 'Live updates' : 'Updates may be delayed'}
      title={isLive ? 'Live updates' : 'Updates may be delayed. Reconnecting…'}
    />
  );
}

export interface OperationsWorkspaceToolbarProps {
  title: string;
  summary: ViewToolbarSummary;
  date: string;
  /** yyyy-mm-dd for “today”; when set, avoids local `new Date()` mismatch between SSR and the browser. */
  todayIso?: string;
  onDateChange: (date: string) => void;
  onPreviousDate?: () => void;
  onNextDate?: () => void;
  dateLabel?: ReactNode;
  liveState: 'live' | 'reconnecting';
  onRefresh: () => void;
  onNewBooking: () => void;
  onWalkIn: () => void;
  /** Calendar + time-range filter (shown in date sheet). */
  datePickerPanel: ReactNode;
  /** Secondary controls (filters, export, areas, etc.). */
  controlsPanel: ReactNode;
  controlsLabel?: string;
  /** Optional timeline controls opened from a compact clock button. */
  timelinePanel?: ReactNode;
  timelineLabel?: string;
  /** Hide the secondary Controls trigger when a view does not need it. */
  showControlsButton?: boolean;
  /** Dense, single-row operations chrome for space-constrained visual workspaces. */
  compact?: boolean;
  /** Always-visible row under KPIs (e.g. floor timeline time). */
  pinnedRow?: ReactNode;
  /** Primary working tools (e.g. guest search + grid zoom). */
  inlineTools?: ReactNode;
  /** Compact tools shown beside the KPI chips. */
  summaryTools?: ReactNode;
  /** Tools after “Today”, before timeline/controls/search. Pass a function to receive `toolbarPanelAnchorRef` for fixed dropdowns. */
  toolbarLeadingTools?: ReactNode | ((toolbarPanelAnchorRef: RefObject<HTMLDivElement | null>) => ReactNode);
  /** Compact tools in the date/action row. Pass a function to receive `toolbarPanelAnchorRef` for fixed dropdowns inside the toolbar card. */
  toolbarTools?: ReactNode | ((toolbarPanelAnchorRef: RefObject<HTMLDivElement | null>) => ReactNode);
  /** Optional search popover content shown from a magnifying-glass icon in compact toolbars. */
  searchPanel?: ReactNode;
  searchActive?: boolean;
  /** Accessible name for the search trigger and dropdown (compact toolbars). */
  searchAriaLabel?: string;
  /** When false, hides prev/next/date/Today controls. Defaults to showing the navigator. */
  showDateNavigator?: boolean;
  /** When false, hides New booking and Walk-in. Defaults to showing both. */
  showBookingActions?: boolean;
  /** Override KPI chips while keeping the same compact toolbar shell. */
  summaryContent?: ReactNode;
  /** When set with default KPI chips, makes Live/Booked, Unassigned, and Next chips actionable. */
  onCoversChipClick?: () => void;
  onUnassignedChipClick?: () => void;
  onNextChipClick?: () => void;
  /** Extra content shown below KPI chips in the Info panel. */
  infoPanelExtra?: ReactNode;
  /** Extra actions after Walk-in (e.g. Edit layout link). */
  trailingActions?: ReactNode;
}

type OpenPanel = 'none' | 'info' | 'date' | 'controls' | 'timeline' | 'search';

export function OperationsWorkspaceToolbar({
  title,
  summary,
  date,
  todayIso: todayIsoProp,
  onDateChange,
  onPreviousDate,
  onNextDate,
  dateLabel,
  liveState,
  onRefresh,
  onNewBooking,
  onWalkIn,
  datePickerPanel,
  controlsPanel,
  controlsLabel = 'Controls',
  timelinePanel,
  timelineLabel,
  showControlsButton = true,
  compact = false,
  pinnedRow,
  inlineTools,
  summaryTools,
  toolbarLeadingTools,
  toolbarTools,
  searchPanel,
  searchActive = false,
  searchAriaLabel = 'Search bookings',
  showDateNavigator = true,
  showBookingActions = true,
  summaryContent,
  onCoversChipClick,
  onUnassignedChipClick,
  onNextChipClick,
  infoPanelExtra,
  trailingActions,
}: OperationsWorkspaceToolbarProps) {
  const baseId = useId();
  const datePanelId = `${baseId}-date-panel`;
  const controlsPanelId = `${baseId}-controls-panel`;
  const timelinePanelId = `${baseId}-timeline-panel`;
  const [open, setOpen] = useState<OpenPanel>('none');
  const sheetRef = useRef<HTMLDivElement>(null);
  const infoPopoverRef = useRef<HTMLDivElement>(null);
  const datePopoverRef = useRef<HTMLDivElement>(null);
  const controlsPopoverRef = useRef<HTMLDivElement>(null);
  const searchPopoverRef = useRef<HTMLDivElement>(null);
  const timelinePopoverRef = useRef<HTMLDivElement>(null);
  const panelSurfaceRef = useRef<HTMLDivElement>(null);
  const infoTriggerRef = useRef<HTMLButtonElement>(null);
  const dateTriggerRef = useRef<HTMLButtonElement>(null);
  const timelineTriggerRef = useRef<HTMLButtonElement>(null);
  const controlsTriggerRef = useRef<HTMLButtonElement>(null);
  const searchTriggerRef = useRef<HTMLButtonElement>(null);
  const [fallbackTodayIso] = useState(() => formatDateInput(new Date()));
  const todayIso = todayIsoProp ?? fallbackTodayIso;
  const isToday = date === todayIso;
  const inlineInfoOpen = compact && open === 'info';
  const inlineDateOpen = compact && open === 'date';
  const inlineControlsOpen = compact && open === 'controls';
  const inlineSearchOpen = compact && open === 'search';
  const inlineTimelineOpen = compact && open === 'timeline';

  const close = useCallback(() => setOpen('none'), []);
  const infoPanelId = `${baseId}-info-panel`;
  const summaryNode =
    summaryContent ??
    (onCoversChipClick || onUnassignedChipClick || onNextChipClick ? (
      <KpiChips
        summary={summary}
        onCoversChipClick={onCoversChipClick}
        onUnassignedChipClick={onUnassignedChipClick}
        onNextChipClick={onNextChipClick}
      />
    ) : (
      <KpiChips summary={summary} />
    ));

  useEffect(() => {
    if (open === 'none' || inlineInfoOpen || inlineDateOpen || inlineControlsOpen || inlineSearchOpen || inlineTimelineOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open, inlineInfoOpen, inlineDateOpen, inlineControlsOpen, inlineSearchOpen, inlineTimelineOpen]);

  useEffect(() => {
    if (open === 'none') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  useEffect(() => {
    if (open === 'none') return;
    let cancelled = false;
    const t = window.setTimeout(() => {
      if (cancelled) return;
      if (open === 'search') {
        const focusSearchField = () => {
          const panel = document.getElementById(`${baseId}-search-panel`);
          const input = panel?.querySelector<HTMLInputElement>('input[type="search"]');
          input?.focus();
          return Boolean(input);
        };
        if (!focusSearchField()) {
          requestAnimationFrame(() => {
            if (!cancelled) focusSearchField();
          });
        }
        return;
      }
      const container = inlineDateOpen
        ? datePopoverRef.current
        : inlineInfoOpen
          ? infoPopoverRef.current
          : inlineControlsOpen
            ? controlsPopoverRef.current
            : inlineTimelineOpen
              ? timelinePopoverRef.current
              : sheetRef.current;
      container?.querySelector<HTMLElement>('button, [href], input, select, textarea')?.focus();
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [open, inlineInfoOpen, inlineDateOpen, inlineControlsOpen, inlineSearchOpen, inlineTimelineOpen, baseId]);

  useEffect(() => {
    if (!inlineInfoOpen && !inlineDateOpen && !inlineControlsOpen && !inlineSearchOpen && !inlineTimelineOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      const t = event.target;
      if (t instanceof Element && t.closest(CALENDAR_PICKER_SUBPOPOVER_SELECTOR)) return;
      if (isBookingDetailPopoverDismissExempt(t, null)) return;
      if (infoPopoverRef.current?.contains(event.target as Node)) return;
      if (datePopoverRef.current?.contains(event.target as Node)) return;
      if (controlsPopoverRef.current?.contains(event.target as Node)) return;
      if (searchPopoverRef.current?.contains(event.target as Node)) return;
      if (timelinePopoverRef.current?.contains(event.target as Node)) return;
      close();
    };

    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [inlineInfoOpen, inlineDateOpen, inlineControlsOpen, inlineSearchOpen, inlineTimelineOpen, close]);

  const compactActionsShellClass =
    'flex w-full min-w-0 flex-wrap items-center justify-start gap-x-1.5 gap-y-1.5 sm:flex-1 sm:justify-end sm:gap-x-2';
  const defaultActionsShellClass =
    '-mx-1 flex min-w-0 max-w-full flex-1 flex-wrap items-center gap-1.5 overflow-x-auto overscroll-x-contain px-1 pb-0.5 [-webkit-overflow-scrolling:touch] sm:mx-0 sm:max-w-none sm:justify-end sm:overflow-visible sm:px-0 sm:pb-0';

  const toolbarActionControls = (
    <>
      {showDateNavigator ? (
        <>
          <div className="flex shrink-0 items-center gap-1">
            <div className={compact ? DATE_NAV_GRID_CLASS_COMPACT : DATE_NAV_GRID_CLASS_DEFAULT}>
              <button
                type="button"
                onClick={onPreviousDate ?? (() => onDateChange(shiftDate(date, -1)))}
                className={compact
                  ? 'inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 shadow-sm hover:bg-slate-50 hover:text-slate-800'
                  : 'inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 shadow-sm hover:bg-slate-50 hover:text-slate-800 sm:h-9 sm:w-9'}
                aria-label="Previous day"
              >
                <svg className={compact ? 'h-4 w-4' : 'h-5 w-5'} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                </svg>
              </button>
              <div ref={datePopoverRef} className="relative min-w-0">
                <button
                  ref={dateTriggerRef}
                  type="button"
                  onClick={() => setOpen((p) => (p === 'date' ? 'none' : 'date'))}
                  title={typeof dateLabel === 'string' ? dateLabel : formatDateHeading(date)}
                  className={compact
                    ? 'inline-flex min-h-8 w-full min-w-0 items-center justify-center rounded-lg border border-slate-200 bg-white px-2 py-1 text-center text-[11px] font-semibold leading-tight text-slate-700 shadow-sm hover:bg-slate-50 sm:text-xs'
                    : 'inline-flex min-h-10 w-full min-w-0 flex-col items-center justify-center rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-center text-xs font-semibold text-slate-800 shadow-sm hover:bg-slate-50 sm:px-2.5 sm:text-sm'}
                  aria-expanded={open === 'date'}
                  aria-controls={datePanelId}
                >
                  <span className="w-full min-w-0 truncate tabular-nums">{dateLabel ?? formatDateHeading(date)}</span>
                  {!compact ? (
                    <span
                      className={`mt-0.5 block min-h-[0.875rem] w-full min-w-0 truncate text-[10px] font-semibold uppercase tracking-wide ${
                        isToday ? 'text-brand-600' : 'text-transparent'
                      }`}
                      aria-hidden={!isToday}
                    >
                      Today
                    </span>
                  ) : null}
                </button>
                <ClampedFixedDropdown
                  open={inlineDateOpen}
                  triggerRef={dateTriggerRef}
                  verticalAnchorRef={compact ? panelSurfaceRef : undefined}
                  horizontalCenter={compact}
                  gapPx={4}
                  align="start"
                  maxWidthPx={352}
                  id={datePanelId}
                  onDismiss={close}
                  ignoreDismissIf={(target) =>
                    target instanceof Element && Boolean(target.closest(CALENDAR_PICKER_SUBPOPOVER_SELECTOR))
                  }
                  aria-label="Date and calendar"
                  className="animate-fade-in z-50 rounded-xl border border-slate-200 bg-white p-2 text-left shadow-xl shadow-slate-900/10 ring-1 ring-slate-100 sm:p-3"
                >
                  {datePickerPanel}
                </ClampedFixedDropdown>
              </div>
              <button
                type="button"
                onClick={onNextDate ?? (() => onDateChange(shiftDate(date, 1)))}
                className={compact
                  ? 'inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 shadow-sm hover:bg-slate-50 hover:text-slate-800'
                  : 'inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 shadow-sm hover:bg-slate-50 hover:text-slate-800 sm:h-9 sm:w-9'}
                aria-label="Next day"
              >
                <svg className={compact ? 'h-4 w-4' : 'h-5 w-5'} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                </svg>
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onDateChange(todayIso)}
            className={compact
              ? 'min-h-8 w-[3.25rem] shrink-0 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 shadow-sm hover:bg-slate-50 sm:text-xs'
              : 'min-h-10 shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 sm:text-sm'}
          >
            Today
          </button>
        </>
      ) : null}
      {toolbarLeadingTools
        ? typeof toolbarLeadingTools === 'function'
          // eslint-disable-next-line react-hooks/refs -- ref object forwarded for dropdown anchoring, not read here
          ? toolbarLeadingTools(panelSurfaceRef)
          : toolbarLeadingTools
        : null}
      {timelinePanel ? (
        <div ref={timelinePopoverRef} className="relative shrink-0">
          <button
            ref={timelineTriggerRef}
            type="button"
            onClick={() => setOpen((p) => (p === 'timeline' ? 'none' : 'timeline'))}
            className={compact
              ? 'inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-700 shadow-sm hover:bg-slate-50 hover:text-slate-900'
              : 'inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 sm:px-3 sm:text-sm'}
            aria-label={timelineLabel ? `Timeline controls, currently set to ${timelineLabel}` : 'Timeline controls'}
            aria-expanded={open === 'timeline'}
            aria-controls={timelinePanelId}
          >
            <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l3.5 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
            {timelineLabel ? <span className="tabular-nums">{timelineLabel}</span> : null}
          </button>
          <ClampedFixedDropdown
            open={inlineTimelineOpen}
            triggerRef={timelineTriggerRef}
            verticalAnchorRef={compact ? panelSurfaceRef : undefined}
            horizontalCenter={compact}
            gapPx={4}
            align="start"
            maxWidthPx={320}
            id={timelinePanelId}
            onDismiss={close}
            aria-label="Timeline controls"
            className="animate-fade-in z-50 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-xl shadow-slate-900/10 ring-1 ring-slate-100"
          >
            {timelinePanel}
          </ClampedFixedDropdown>
        </div>
      ) : null}
      {showControlsButton ? (
        <div ref={controlsPopoverRef} className="relative shrink-0">
          <button
            ref={controlsTriggerRef}
            type="button"
            onClick={() => setOpen((p) => (p === 'controls' ? 'none' : 'controls'))}
            className={compact
              ? 'min-h-8 w-[4.25rem] shrink-0 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 shadow-sm hover:bg-slate-50 sm:text-xs'
              : 'min-h-10 shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 sm:px-3 sm:text-sm'}
            aria-expanded={open === 'controls'}
            aria-controls={controlsPanelId}
          >
            {controlsLabel}
          </button>
          <ClampedFixedDropdown
            open={inlineControlsOpen}
            triggerRef={controlsTriggerRef}
            verticalAnchorRef={compact ? panelSurfaceRef : undefined}
            horizontalCenter={compact}
            gapPx={4}
            align="start"
            maxWidthPx={384}
            id={controlsPanelId}
            onDismiss={close}
            aria-label={controlsLabel}
            className="animate-fade-in z-50 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-xl shadow-slate-900/10 ring-1 ring-slate-100"
          >
            {controlsPanel}
          </ClampedFixedDropdown>
        </div>
      ) : null}
      {toolbarTools
        ? typeof toolbarTools === 'function'
          // This render prop only forwards the ref object to child overlay components;
          // it does not read `.current` during render.
          // eslint-disable-next-line react-hooks/refs
          ? toolbarTools(panelSurfaceRef)
          : toolbarTools
        : null}
      {searchPanel ? (
        <div ref={searchPopoverRef} className="relative shrink-0">
          <button
            ref={searchTriggerRef}
            type="button"
            onClick={() => setOpen((p) => (p === 'search' ? 'none' : 'search'))}
            className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-slate-700 shadow-sm hover:bg-slate-50 hover:text-slate-900 ${
              searchActive
                ? 'border-brand-300 bg-brand-50 text-brand-700 ring-1 ring-brand-200'
                : 'border-slate-200 bg-white'
            }`}
            aria-label={searchAriaLabel}
            aria-expanded={open === 'search'}
            aria-controls={`${baseId}-search-panel`}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
            </svg>
          </button>
          <ClampedFixedDropdown
            open={inlineSearchOpen}
            triggerRef={searchTriggerRef}
            verticalAnchorRef={compact ? panelSurfaceRef : undefined}
            horizontalCenter={compact}
            gapPx={4}
            align="end"
            maxWidthPx={400}
            id={`${baseId}-search-panel`}
            onDismiss={close}
            ignoreDismissIf={(target) => isBookingDetailPopoverDismissExempt(target, null)}
            aria-label={searchAriaLabel}
            className="animate-fade-in z-50 w-[min(100vw-2rem,24rem)] rounded-xl border border-slate-200 bg-white p-3 text-left shadow-xl shadow-slate-900/10 ring-1 ring-slate-100"
          >
            {searchPanel}
          </ClampedFixedDropdown>
        </div>
      ) : null}
      <button
        type="button"
        onClick={onRefresh}
        className={compact
          ? 'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 shadow-sm hover:bg-slate-50 hover:text-slate-800'
          : 'inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 shadow-sm hover:bg-slate-50 hover:text-slate-800 sm:h-9 sm:w-9'}
        aria-label="Refresh"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182"
          />
        </svg>
      </button>
      {!compact ? (
        <span className="inline-flex h-9 shrink-0 items-center px-1">
          <LiveStateIndicator state={liveState} />
        </span>
      ) : null}
      {showBookingActions ? (
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onNewBooking}
            className={
              compact
                ? `${COMPACT_BOOKING_ACTION_LAYOUT} bg-brand-600 hover:bg-brand-700`
                : 'inline-flex h-10 min-w-[6.75rem] max-w-[7.25rem] items-center justify-center gap-1.5 rounded-lg bg-brand-600 px-2.5 text-xs font-semibold text-white shadow-sm hover:bg-brand-700 sm:min-w-[7rem] sm:px-3 sm:text-sm'
            }
            aria-label="New Booking"
          >
            <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            <span className={compact ? 'hidden min-w-0 truncate sm:inline' : 'min-w-0 truncate'}>New</span>
          </button>
          <button
            type="button"
            onClick={onWalkIn}
            className={
              compact
                ? `${COMPACT_BOOKING_ACTION_LAYOUT} bg-emerald-600 hover:bg-emerald-700`
                : 'inline-flex h-10 min-w-[6.75rem] max-w-[7.25rem] items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-2.5 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700 sm:min-w-[7rem] sm:px-3 sm:text-sm'
            }
            aria-label="Walk-in"
          >
            <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z"
              />
            </svg>
            <span className={compact ? 'hidden min-w-0 truncate sm:inline' : 'min-w-0 truncate'}>Walk-in</span>
          </button>
        </div>
      ) : null}
      {trailingActions}
    </>
  );

  return (
    <div className="shrink-0 space-y-1">
      <div
        className={
          compact
              ? 'rounded-xl border border-slate-200/90 bg-white/95 px-2 py-1.5 shadow-sm backdrop-blur sm:px-2.5 sm:py-2'
            : 'rounded-xl border border-slate-200/90 bg-white/95 px-2 py-1.5 shadow-sm backdrop-blur sm:px-3 sm:py-2'
        }
      >
        <div
          ref={compact ? panelSurfaceRef : undefined}
          className={
            compact
              ? 'flex min-w-0 flex-col gap-2'
              : 'flex flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between sm:gap-3 lg:gap-4'
          }
        >
          {compact ? (
            <>
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3 md:items-center">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
                  <h1 className="min-w-0 max-w-full shrink truncate text-sm font-bold tracking-tight text-slate-900 sm:max-w-[16rem] md:max-w-[20rem] lg:max-w-xl lg:shrink-0 sm:text-base">
                    {title}
                  </h1>
                  <div ref={infoPopoverRef} className="relative shrink-0">
                    <button
                      ref={infoTriggerRef}
                      type="button"
                      onClick={() => setOpen((p) => (p === 'info' ? 'none' : 'info'))}
                      className={`inline-flex h-7 items-center justify-center rounded-lg border px-2 text-[11px] font-semibold shadow-sm hover:bg-slate-50 ${
                        open === 'info'
                          ? 'border-brand-300 bg-brand-50 text-brand-800 ring-1 ring-brand-200'
                          : 'border-slate-200 bg-white text-slate-700'
                      }`}
                      aria-expanded={open === 'info'}
                      aria-controls={infoPanelId}
                    >
                      Info
                    </button>
                    <ClampedFixedDropdown
                      open={inlineInfoOpen}
                      triggerRef={infoTriggerRef}
                      verticalAnchorRef={panelSurfaceRef}
                      horizontalCenter
                      gapPx={4}
                      align="start"
                      maxWidthPx={360}
                      id={infoPanelId}
                      onDismiss={close}
                      aria-label="View summary information"
                      className="animate-fade-in z-50 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-xl shadow-slate-900/10 ring-1 ring-slate-100"
                    >
                      <div className="space-y-3">
                        {summaryNode}
                        {infoPanelExtra}
                      </div>
                    </ClampedFixedDropdown>
                  </div>
                  <span className="inline-flex h-7 shrink-0 items-center px-1">
                    <LiveStateIndicator state={liveState} />
                  </span>
                  {summaryTools ? <div className="flex shrink-0 items-center gap-1">{summaryTools}</div> : null}
                </div>
                <div className={compactActionsShellClass}>{toolbarActionControls}</div>
              </div>
              {pinnedRow ? <div className="w-full border-t border-slate-100 pt-1.5 sm:pt-2">{pinnedRow}</div> : null}
              {inlineTools ? <div className="w-full border-t border-slate-100 pt-1.5 sm:pt-2">{inlineTools}</div> : null}
            </>
          ) : (
            <>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Operations</p>
                <h1 className="truncate text-sm font-bold tracking-tight text-slate-900 sm:text-base">{title}</h1>
                <div className="mt-1">{summaryNode}</div>
                {summaryTools ? <div className="mt-1">{summaryTools}</div> : null}
              </div>
              <div className={defaultActionsShellClass}>{toolbarActionControls}</div>
            </>
          )}
        </div>
        {!compact && pinnedRow ? <div className="mt-1.5 border-t border-slate-100 pt-1.5">{pinnedRow}</div> : null}
        {!compact && inlineTools ? <div className="mt-1.5 border-t border-slate-100 pt-1.5">{inlineTools}</div> : null}
      </div>

      {open !== 'none' && !inlineInfoOpen && !inlineDateOpen && !inlineControlsOpen && !inlineSearchOpen && !inlineTimelineOpen ? (
        <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-stretch sm:justify-end">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px]"
            aria-label="Close panel"
            onClick={close}
          />
          <div
            ref={sheetRef}
            id={open === 'date' ? datePanelId : open === 'timeline' ? timelinePanelId : open === 'search' ? `${baseId}-search-panel` : controlsPanelId}
            role="dialog"
            aria-modal="true"
            aria-label={open === 'info' ? 'View summary information' : open === 'date' ? 'Date and calendar' : open === 'timeline' ? 'Timeline controls' : open === 'search' ? searchAriaLabel : controlsLabel}
            className="relative z-[71] flex max-h-[min(92dvh,920px)] w-full max-w-lg flex-col rounded-t-2xl border border-slate-200 bg-white shadow-2xl sm:h-full sm:max-h-none sm:max-w-md sm:rounded-none sm:rounded-l-2xl sm:border-y sm:border-l sm:border-r-0 sm:border-slate-200 sm:shadow-xl"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-3 py-2 sm:px-4">
              <h2 className="text-sm font-semibold text-slate-900">
                {open === 'info' ? 'Info' : open === 'date' ? 'Date' : open === 'timeline' ? 'Timeline' : open === 'search' ? 'Search' : controlsLabel}
              </h2>
              <button
                type="button"
                onClick={close}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                aria-label="Close"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-4 sm:py-4">
              {open === 'info' ? (
                <div className="space-y-3">
                  {summaryNode}
                  {infoPanelExtra}
                </div>
              ) : open === 'date' ? datePickerPanel : open === 'timeline' ? timelinePanel : open === 'search' ? searchPanel : controlsPanel}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
