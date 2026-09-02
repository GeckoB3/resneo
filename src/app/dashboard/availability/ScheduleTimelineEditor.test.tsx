/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ScheduleTimelineEditor } from './ScheduleTimelineEditor';
import { monthCells, summariseDay } from './ScheduleCalendarPreview';
import type { CalendarSchedule } from '@/lib/availability/working-hours-rota';

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

const noLeave = vi.fn(async () => []);
const SEPTEMBER = { year: 2026, monthIndex: 8 };

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
      initialMonth={SEPTEMBER}
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

  it('picking a day explains its rule and offers to change hours from that week', () => {
    renderEditor({ value: ROTA });
    fireEvent.click(screen.getByRole('gridcell', { name: /^2026-09-15:/ }));
    expect(screen.getByText('Tuesday 15 September 2026')).toBeInTheDocument();
    expect(screen.getByText(/Rule: change from Mon 7 Sep 2026, week 2 of 2/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /change hours from this week/i }));
    // The form opens on the Monday of the picked week.
    expect(screen.getByLabelText(/new hours from/i)).toHaveValue('2026-09-14');
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
