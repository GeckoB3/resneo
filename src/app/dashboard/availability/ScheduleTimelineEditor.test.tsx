/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ScheduleTimelineEditor } from './ScheduleTimelineEditor';
import { monthCells, summariseDay } from './ScheduleCalendarPreview';
import { SCHEDULE_MAX_PERIODS, addDaysYmd, type CalendarSchedule, type SchedulePeriod } from '@/lib/availability/working-hours-rota';
import type { AvailabilityBlock } from '@/types/availability';

const WEEKLY = { '1': [{ start: '09:00', end: '17:00' }], '2': [{ start: '09:00', end: '17:00' }] };
const VENUE = {
  '1': { periods: [{ open: '10:00', close: '18:00' }] },
  '2': { periods: [{ open: '08:00', close: '20:00' }] },
  '3': { closed: true as const },
};

const ROTA: CalendarSchedule = {
  version: 1,
  periods: [
    {
      id: 'rota',
      from: '2026-09-07',
      until: '2026-10-04',
      cycle_start: '2026-09-07',
      weeks: [{ '1': [{ start: '09:00', end: '13:00' }] }, { '2': [{ start: '12:00', end: '18:00' }] }],
    },
  ],
};

/** A change that ran in August and has ended, ahead of the rota. */
const ENDED: SchedulePeriod = {
  id: 'ended',
  from: '2026-08-03',
  until: '2026-08-30',
  cycle_start: '2026-08-03',
  weeks: [{ '1': [{ start: '14:00', end: '16:00' }] }],
};

const noLeave = vi.fn(async () => []);
const noBlocks = vi.fn(async (): Promise<AvailabilityBlock[]> => []);
const SEPTEMBER = { year: 2026, monthIndex: 8 };
const TODAY = '2026-09-04';

function closure(date: string, times: { start: string; end: string } | null = null, type: AvailabilityBlock['block_type'] = 'closed'): AvailabilityBlock {
  return {
    id: `blk-${date}-${type}`,
    venue_id: 'venue-1',
    service_id: null,
    block_type: type,
    date_start: date,
    date_end: date,
    time_start: times?.start ?? null,
    time_end: times?.end ?? null,
    override_max_covers: null,
    reason: null,
  };
}

function renderEditor(over: Partial<Parameters<typeof ScheduleTimelineEditor>[0]> = {}) {
  const onSave = vi.fn(async (_s: CalendarSchedule | null) => {});
  const onCopyTo = vi.fn(async (_ids: string[], _s: CalendarSchedule) => {});
  render(
    <ScheduleTimelineEditor
      calendarId="cal-1"
      calendarName="Ada"
      value={null}
      weeklyHours={WEEKLY}
      daysOff={[]}
      venueHours={VENUE}
      onSave={onSave}
      saving={false}
      copyTargets={[{ id: 'ben', name: 'Ben' }]}
      onCopyTo={onCopyTo}
      loadLeave={noLeave}
      loadVenueBlocks={noBlocks}
      initialMonth={SEPTEMBER}
      todayYmd={TODAY}
      {...over}
    />,
  );
  return { onSave, onCopyTo };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('summariseDay', () => {
  const base = { baseHours: WEEKLY, schedule: ROTA, daysOff: [] as string[], venueHours: VENUE, leave: [] };

  it('shows the hours inside the venue hours, with the rule that produced them', () => {
    // Mon 7 Sep: rota week 1 gives 09:00-13:00, venue opens 10:00.
    expect(summariseDay({ ...base, date: '2026-09-07' })).toMatchObject({ text: '10:00–13:00', reason: 'period', source: { weekIndex: 0 } });
    // Tue 15 Sep: rota week 2 gives 12:00-18:00 inside the venue's 08:00-20:00.
    expect(summariseDay({ ...base, date: '2026-09-15' })).toMatchObject({ text: '12:00–18:00', source: { weekIndex: 1 } });
    // Mon 5 Oct: after the period, base hours 09:00-17:00 inside 10:00-18:00.
    expect(summariseDay({ ...base, date: '2026-10-05' })).toMatchObject({ text: '10:00–17:00', reason: 'base' });
    // Mon 14 Sep: rota week 2 has no Monday.
    expect(summariseDay({ ...base, date: '2026-09-14' })).toMatchObject({ text: 'Closed', reason: 'no-hours' });
  });

  it('closed reasons win in the right order: leave, then day off, then the venue', () => {
    expect(summariseDay({ ...base, date: '2026-09-08', leave: [{ start_date: '2026-09-08', end_date: '2026-09-09' }] })).toMatchObject({ text: 'Leave', reason: 'leave' });
    expect(summariseDay({ ...base, date: '2026-09-08', daysOff: ['2026-09-08'] })).toMatchObject({ text: 'Day off', reason: 'day-off' });
    expect(summariseDay({ ...base, date: '2026-09-09' })).toMatchObject({ text: 'Venue closed', reason: 'venue-closed' });
    expect(
      summariseDay({ ...base, date: '2026-09-15', leave: [{ start_date: '2026-09-15', end_date: '2026-09-15', unavailable_start_time: '14:00', unavailable_end_time: '15:00' }] }),
    ).toMatchObject({ text: '12:00–18:00', partialLeave: '14:00–15:00' });
  });

  /**
   * The venue side reads through the same resolver the engines use, so a closure or
   * an amended-hours day on the calendar page matches what a guest can book.
   */
  it('applies venue closures and amended hours the way the booking engines do', () => {
    // A whole-day closure on a Tuesday the calendar works.
    expect(summariseDay({ ...base, date: '2026-09-15', venueWideBlocks: [closure('2026-09-15')] })).toMatchObject({ text: 'Venue closed', reason: 'venue-closure' });
    // A part-day closure takes those minutes away.
    expect(summariseDay({ ...base, date: '2026-09-15', venueWideBlocks: [closure('2026-09-15', { start: '12:00', end: '14:00' })] })).toMatchObject({ text: '14:00–18:00' });
    // Amended hours replace the weekly venue hours, so the calendar's 12:00-18:00 is clipped to them.
    const amended: AvailabilityBlock = { ...closure('2026-09-15', null, 'amended_hours'), override_periods: [{ open: '13:00', close: '15:00' }] };
    expect(summariseDay({ ...base, date: '2026-09-15', venueWideBlocks: [amended] })).toMatchObject({ text: '13:00–15:00' });
    // A weekly-closed day with amended hours opens specially.
    const wedOpen: AvailabilityBlock = { ...closure('2026-09-09', null, 'amended_hours'), override_periods: [{ open: '09:00', close: '12:00' }] };
    expect(summariseDay({ ...base, date: '2026-09-09', baseHours: { '3': [{ start: '08:00', end: '18:00' }] }, schedule: null, venueWideBlocks: [wedOpen] })).toMatchObject({ text: '09:00–12:00', reason: 'base' });
  });

  it('lays a month out Monday-first', () => {
    const cells = monthCells(2026, 8);
    // September 2026 starts on a Tuesday, so one blank sits under Monday.
    expect(cells.slice(0, 3)).toEqual([null, '2026-09-01', '2026-09-02']);
    expect(cells.length % 7).toBe(0);
    expect(cells.at(-1)).toBeNull(); // 30 September is a Wednesday
    expect(cells.filter(Boolean)).toHaveLength(30);
  });
});

describe('ScheduleTimelineEditor', () => {
  it('lists the standard hours row and each period, and the calendar shows bookable hours per day', async () => {
    renderEditor({ value: ROTA });
    const timeline = screen.getByRole('list', { name: /schedule timeline/i });
    expect(within(timeline).getAllByRole('listitem')).toHaveLength(2);
    expect(timeline).toHaveTextContent('From Mon 7 Sep 2026, until Sun 4 Oct 2026: 2-week rota');
    await waitFor(() => expect(noLeave).toHaveBeenCalled());
    expect(screen.getByRole('gridcell', { name: '2026-09-07: 10:00–13:00' })).toBeInTheDocument();
    expect(screen.getByRole('gridcell', { name: '2026-09-15: 12:00–18:00' })).toBeInTheDocument();
    expect(screen.getByRole('gridcell', { name: '2026-09-09: Venue closed' })).toBeInTheDocument();
  });

  /**
   * A calendar that changes its hours often collects ended changes. They stay in
   * the timeline (the calendar pages back through them) but not in the list.
   */
  it('keeps changes that have ended out of the list until asked, and still draws them on the calendar', async () => {
    renderEditor({ value: { version: 1, periods: [ENDED, ...ROTA.periods] }, initialMonth: { year: 2026, monthIndex: 7 } });
    const timeline = screen.getByRole('list', { name: /schedule timeline/i });
    expect(within(timeline).getAllByRole('listitem')).toHaveLength(2);
    expect(timeline).not.toHaveTextContent('From Mon 3 Aug 2026');
    // August still shows the ended change's hours (14:00-16:00 inside the venue's 10:00-18:00).
    await waitFor(() => expect(noLeave).toHaveBeenCalled());
    expect(screen.getByRole('gridcell', { name: '2026-08-10: 14:00–16:00' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /show 1 past change/i }));
    const past = screen.getByRole('list', { name: /past schedule changes/i });
    expect(past).toHaveTextContent('From Mon 3 Aug 2026, until Sun 30 Aug 2026: same hours every week (ended)');
    expect(within(past).getByRole('button', { name: /^remove$/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /hide past changes/i }));
    expect(screen.queryByRole('list', { name: /past schedule changes/i })).toBeNull();
  });

  it('picking a day explains its rule and offers to change hours from that week', async () => {
    renderEditor({ value: ROTA });
    await waitFor(() => expect(noBlocks).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('gridcell', { name: /^2026-09-15:/ }));
    expect(screen.getByText('Tuesday 15 September 2026')).toBeInTheDocument();
    expect(screen.getByText(/Rule: change from Mon 7 Sep 2026, week 2 of 2/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /change hours from this week/i }));
    // The form opens on the Monday of the picked week.
    expect(screen.getByLabelText(/new hours from/i)).toHaveValue('2026-09-14');
  });

  it('names a venue closure when the picked day has one', async () => {
    renderEditor({ value: ROTA, loadVenueBlocks: async () => [closure('2026-09-15')] });
    await waitFor(() => expect(screen.getByRole('gridcell', { name: '2026-09-15: Venue closed' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('gridcell', { name: '2026-09-15: Venue closed' }));
    expect(screen.getByText(/Your venue has a closure on this date/)).toBeInTheDocument();
  });

  it('adds a change from a future date and saves the timeline with the neighbour trimmed', async () => {
    const { onSave } = renderEditor({ value: ROTA });
    fireEvent.click(screen.getByRole('button', { name: /add a change from a date/i }));
    fireEvent.change(screen.getByLabelText(/new hours from/i), { target: { value: '2026-09-23' } }); // a Wednesday
    expect(screen.getByLabelText(/new hours from/i)).toHaveValue('2026-09-21');
    expect(screen.getByRole('status')).toHaveTextContent(/Shortens the change from Mon 7 Sep 2026 to end on Sun 20 Sep 2026/);

    fireEvent.click(screen.getByRole('button', { name: /add to schedule/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const saved = onSave.mock.calls[0]![0]!;
    expect(saved.periods.map((p) => [p.from, p.until, p.weeks.length])).toEqual([
      ['2026-09-07', '2026-09-20', 2],
      ['2026-09-21', null, 1],
    ]);
    expect(saved.periods[1]!.weeks[0]).toEqual(WEEKLY);
  });

  /** A full timeline makes room by dropping the change that ended longest ago, and says so. */
  it('drops the oldest ended change when the timeline is full, and never a current one', async () => {
    // 49 one-week changes ending before today, then the rota (current), fills the timeline.
    const past: SchedulePeriod[] = Array.from({ length: SCHEDULE_MAX_PERIODS - 1 }, (_, i) => {
      const from = addDaysYmd('2026-08-31', -7 * (i + 1));
      return { id: `old-${i}`, from, until: addDaysYmd(from, 6), cycle_start: from, weeks: [WEEKLY] };
    }).reverse();
    const { onSave } = renderEditor({ value: { version: 1, periods: [...past, ...ROTA.periods] } });
    expect(screen.getByRole('button', { name: new RegExp(`show ${SCHEDULE_MAX_PERIODS - 1} past changes`, 'i') })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /add a change from a date/i }));
    fireEvent.change(screen.getByLabelText(/new hours from/i), { target: { value: '2026-10-12' } });
    expect(screen.getByRole('status')).toHaveTextContent(/Drops the past change from Mon 22 Sep 2025 \(ended Sun 28 Sep 2025\) to stay within 50 changes/);

    fireEvent.click(screen.getByRole('button', { name: /add to schedule/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const saved = onSave.mock.calls[0]![0]!;
    expect(saved.periods).toHaveLength(SCHEDULE_MAX_PERIODS);
    expect(saved.periods.map((p) => p.id)).not.toContain('old-48');
    expect(saved.periods.map((p) => p.id)).toContain('rota');
  });

  it('removes a period after confirming, and saves null when none remain', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    const { onSave } = renderEditor({ value: ROTA });
    fireEvent.click(screen.getByRole('button', { name: /^remove$/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(null));
  });

  it('copies the saved timeline to chosen calendars', async () => {
    const { onCopyTo } = renderEditor({ value: ROTA });
    fireEvent.click(screen.getByLabelText('Ben'));
    fireEvent.click(screen.getByRole('button', { name: /copy to 1 calendar/i }));
    await waitFor(() => expect(onCopyTo).toHaveBeenCalledWith(['ben'], ROTA));
  });

  it('reads the older single rota while the timeline is null', () => {
    renderEditor({ value: null, legacyRota: { version: 1, cycle_start: '2026-09-07', weeks: ROTA.periods[0]!.weeks, repeat_until: '2026-09-30' } });
    expect(screen.getByRole('list', { name: /schedule timeline/i })).toHaveTextContent('From Mon 7 Sep 2026, until Sun 4 Oct 2026: 2-week rota');
  });

  it('is view only for staff who cannot edit the calendar', () => {
    renderEditor({ value: ROTA, readOnly: true });
    expect(screen.queryByRole('button', { name: /add a change/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^edit$/i })).toBeNull();
  });
});
