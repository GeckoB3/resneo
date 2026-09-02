/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { RotatingScheduleEditor } from './RotatingScheduleEditor';
import type { WorkingHoursRota } from '@/lib/availability/working-hours-rota';

const WEEKLY = { '1': [{ start: '09:00', end: '17:00' }] };
const STORED: WorkingHoursRota = {
  version: 1,
  cycle_start: '2026-09-07',
  weeks: [{ '1': [{ start: '09:00', end: '13:00' }] }, { '2': [{ start: '10:00', end: '18:00' }] }],
  repeat_until: '2026-11-29', // six cycles of two weeks
};

function renderEditor(over: Partial<Parameters<typeof RotatingScheduleEditor>[0]> = {}) {
  const onSave = vi.fn(async (_rota: WorkingHoursRota | null) => {});
  const onCopyTo = vi.fn(async (_ids: string[], _rota: WorkingHoursRota) => {});
  render(
    <RotatingScheduleEditor
      calendarName="Ada"
      value={null}
      weeklyHours={WEEKLY}
      onSave={onSave}
      saving={false}
      copyTargets={[{ id: 'ben', name: 'Ben' }]}
      onCopyTo={onCopyTo}
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

describe('RotatingScheduleEditor', () => {
  it('starts switched off with no stored rota and shows nothing else', () => {
    renderEditor();
    expect(screen.getByRole('switch')).not.toBeChecked();
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('seeds a new rota from the weekly hours, snaps the start to a Monday, and saves an end date for N cycles', async () => {
    const { onSave } = renderEditor();
    fireEvent.click(screen.getByRole('switch'));

    // Two week tabs by default, both a copy of the weekly hours.
    expect(within(screen.getByRole('tablist')).getAllByRole('tab')).toHaveLength(2);

    fireEvent.change(screen.getByLabelText(/week 1 starts on/i), { target: { value: '2026-09-10' } }); // a Thursday
    expect(screen.getByLabelText(/week 1 starts on/i)).toHaveValue('2026-09-07');
    expect(screen.getByText(/Monday 7 September 2026/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: /^for/i }));
    fireEvent.change(screen.getByLabelText(/number of cycles/i), { target: { value: '3' } });
    expect(screen.getByText(/ends on Sunday 18 October 2026/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /save rotating schedule/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const saved = onSave.mock.calls[0]![0] as WorkingHoursRota;
    expect(saved.cycle_start).toBe('2026-09-07');
    expect(saved.weeks).toEqual([WEEKLY, WEEKLY]);
    expect(saved.repeat_until).toBe('2026-10-18');
  });

  it('grows and shrinks the cycle, editing one week at a time', () => {
    renderEditor();
    fireEvent.click(screen.getByRole('switch'));
    fireEvent.change(screen.getByLabelText(/cycle length/i), { target: { value: '4' } });
    expect(within(screen.getByRole('tablist')).getAllByRole('tab')).toHaveLength(4);
    fireEvent.click(screen.getByRole('tab', { name: 'Week 4' }));
    expect(screen.getByRole('tab', { name: 'Week 4' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.change(screen.getByLabelText(/cycle length/i), { target: { value: '2' } });
    expect(within(screen.getByRole('tablist')).getAllByRole('tab')).toHaveLength(2);
    expect(screen.getByRole('tab', { name: 'Week 2' })).toHaveAttribute('aria-selected', 'true');
  });

  it('reads a stored rota back as "for N cycles", summarises it, and offers remove and copy', async () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal('confirm', confirm);
    const { onSave, onCopyTo } = renderEditor({ value: STORED });
    expect(screen.getByRole('switch')).toBeChecked();
    expect(screen.getByText(/Repeats every 2 weeks from Monday 7 September 2026, until Sunday 29 November 2026/)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^for/i })).toBeChecked();
    expect(screen.getByLabelText(/number of cycles/i)).toHaveValue(6);

    fireEvent.click(screen.getByLabelText('Ben'));
    fireEvent.click(screen.getByRole('button', { name: /copy to 1 calendar/i }));
    await waitFor(() => expect(onCopyTo).toHaveBeenCalledWith(['ben'], STORED));

    fireEvent.click(screen.getByRole('button', { name: /remove rotating schedule/i }));
    expect(confirm).toHaveBeenCalled();
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(null));
  });

  it('reads an "until a date" rota that ends mid-cycle as until, and refuses an end before the start', async () => {
    const { onSave } = renderEditor({ value: { ...STORED, repeat_until: '2026-11-30' } });
    // The "Until" radio's accessible name includes its date input's label.
    expect(screen.getByRole('radio', { name: /last day of the rotating schedule/i })).toBeChecked();
    expect(screen.getByLabelText(/last day of the rotating schedule/i)).toHaveValue('2026-11-30');

    fireEvent.change(screen.getByLabelText(/last day of the rotating schedule/i), { target: { value: '2026-09-01' } });
    fireEvent.click(screen.getByRole('button', { name: /save rotating schedule/i }));
    await screen.findByRole('alert');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('is view only for staff who cannot edit the calendar', () => {
    renderEditor({ value: STORED, readOnly: true });
    expect(screen.getByRole('switch')).toBeDisabled();
    expect(screen.queryByRole('button', { name: /save rotating schedule/i })).toBeNull();
    expect(screen.getByText(/view only/i)).toBeInTheDocument();
  });
});
