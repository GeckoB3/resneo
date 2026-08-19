/** @vitest-environment happy-dom */
import { describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { OpeningHoursControl } from '@/components/scheduling/OpeningHoursControl';
import { WorkingHoursControl } from '@/components/scheduling/WorkingHoursControl';
import type { OpeningHoursSettings } from '@/app/dashboard/settings/types';
import type { WorkingHours } from '@/types/booking-models';

/**
 * Decision (K): three weekly-hours editors collapse onto one shared component, with each
 * caller keeping only its storage shape.
 *
 * These fixtures are about the ADAPTERS, not the widget. The shared editor works on a
 * normalised week; the two stored formats differ in field names, in how a closed day is
 * expressed, and in day order. A conversion bug here would not throw, would not fail
 * typecheck, and would quietly rewrite a venue's hours the first time anyone opened the
 * screen and saved. So the property under test throughout is: what comes out is what went
 * in, plus exactly the edit that was made.
 */

describe('OpeningHoursControl adapter (venue hours)', () => {
  const MONDAY_9_TO_5: OpeningHoursSettings = {
    '1': { periods: [{ open: '09:00', close: '17:00' }] },
    '0': { closed: true },
  };

  it('renders a day per weekday, Sunday first', () => {
    render(<OpeningHoursControl value={MONDAY_9_TO_5} onChange={() => {}} />);

    for (const label of ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('shows a stored period in its inputs', () => {
    render(<OpeningHoursControl value={MONDAY_9_TO_5} onChange={() => {}} />);

    expect(screen.getByLabelText('Monday period 1 opens')).toHaveValue('09:00');
    expect(screen.getByLabelText('Monday period 1 closes')).toHaveValue('17:00');
  });

  it('writes a closed day as { closed: true }, never as an empty period list', () => {
    const onChange = vi.fn();
    render(<OpeningHoursControl value={MONDAY_9_TO_5} onChange={onChange} />);

    // Untick Monday.
    fireEvent.click(screen.getByRole('checkbox', { name: /Monday/ }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0]['1']).toEqual({ closed: true });
  });

  it('edits one period without disturbing the others', () => {
    const onChange = vi.fn();
    const value: OpeningHoursSettings = {
      '1': { periods: [{ open: '09:00', close: '12:00' }] },
      '2': { periods: [{ open: '10:00', close: '16:00' }] },
    };
    render(<OpeningHoursControl value={value} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('Monday period 1 closes'), { target: { value: '13:00' } });

    const next = onChange.mock.calls[0]![0];
    expect(next['1']).toEqual({ periods: [{ open: '09:00', close: '13:00' }] });
    expect(next['2']).toEqual({ periods: [{ open: '10:00', close: '16:00' }] });
  });

  /** The change the cap used to prevent. */
  it('adds a third period', () => {
    const onChange = vi.fn();
    const value: OpeningHoursSettings = {
      '1': {
        periods: [
          { open: '08:00', close: '11:00' },
          { open: '13:00', close: '16:00' },
        ],
      },
    };
    render(<OpeningHoursControl value={value} onChange={onChange} />);

    fireEvent.click(screen.getAllByText('+ Add period')[0]!);

    const next = onChange.mock.calls[0]![0];
    expect(next['1'].periods).toHaveLength(3);
    // An hour's gap after the previous close, never a duplicate of it.
    expect(next['1'].periods[2]).toEqual({ open: '17:00', close: '18:00' });
  });

  it('offers no Add when the last period reaches the end of the day', () => {
    const value: OpeningHoursSettings = {
      '1': { periods: [{ open: '09:00', close: '23:30' }] },
    };
    render(<OpeningHoursControl value={value} onChange={() => {}} />);

    expect(screen.getByText(/no room for another one/)).toBeInTheDocument();
  });

  /** The legacy single-range form still has to be readable. */
  it('reads the legacy { open, close } day shape as one period', () => {
    const legacy = { '1': { open: '10:00', close: '14:00' } } as unknown as OpeningHoursSettings;
    render(<OpeningHoursControl value={legacy} onChange={() => {}} />);

    expect(screen.getByLabelText('Monday period 1 opens')).toHaveValue('10:00');
    expect(screen.getByLabelText('Monday period 1 closes')).toHaveValue('14:00');
  });
});

describe('WorkingHoursControl adapter (calendar hours)', () => {
  const MON_WED: WorkingHours = {
    '1': [{ start: '09:00', end: '17:00' }],
    '3': [{ start: '10:00', end: '15:00' }],
  };

  it('renders Monday first, Sunday last', () => {
    render(<WorkingHoursControl value={MON_WED} onChange={() => {}} />);

    const labels = screen.getAllByText(/^(Monday|Sunday)$/).map((n) => n.textContent);
    expect(labels[0]).toBe('Monday');
    expect(labels[labels.length - 1]).toBe('Sunday');
  });

  it('maps start/end to the shared open/close and back again', () => {
    const onChange = vi.fn();
    render(<WorkingHoursControl value={MON_WED} onChange={onChange} />);

    expect(screen.getByLabelText('Monday period 1 opens')).toHaveValue('09:00');

    fireEvent.change(screen.getByLabelText('Monday period 1 opens'), { target: { value: '08:00' } });

    expect(onChange.mock.calls[0]![0]['1']).toEqual([{ start: '08:00', end: '17:00' }]);
  });

  /**
   * The previous implementation DELETED the key for a non-working day rather than storing
   * an empty array, and callers persist this object as-is. `{}` and `{ '1': [] }` are not
   * the same stored value, so the adapter has to keep deleting.
   */
  it('DELETES the key for a non-working day rather than storing an empty array', () => {
    const onChange = vi.fn();
    render(<WorkingHoursControl value={MON_WED} onChange={onChange} />);

    fireEvent.click(screen.getByRole('checkbox', { name: /Monday/ }));

    const next = onChange.mock.calls[0]![0];
    expect('1' in next).toBe(false);
    expect(next['3']).toEqual([{ start: '10:00', end: '15:00' }]);
  });

  it('leaves days it does not display untouched', () => {
    const onChange = vi.fn();
    const withExtra = { ...MON_WED, weird: [{ start: '01:00', end: '02:00' }] } as unknown as WorkingHours;
    render(<WorkingHoursControl value={withExtra} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('Monday period 1 opens'), { target: { value: '08:00' } });

    expect((onChange.mock.calls[0]![0] as Record<string, unknown>).weird).toEqual([
      { start: '01:00', end: '02:00' },
    ]);
  });

  it('adds a split, keeping the calendar wording', () => {
    const onChange = vi.fn();
    render(<WorkingHoursControl value={MON_WED} onChange={onChange} />);

    fireEvent.click(screen.getAllByText('+ Add split')[0]!);

    expect(onChange.mock.calls[0]![0]['1']).toEqual([
      { start: '09:00', end: '17:00' },
      { start: '18:00', end: '19:00' },
    ]);
  });

  it('copies a day to the other working days, and only to those', () => {
    const onChange = vi.fn();
    render(<WorkingHoursControl value={MON_WED} onChange={onChange} />);

    fireEvent.click(screen.getAllByTitle(/Apply this day's hours/)[0]!);

    const next = onChange.mock.calls[0]![0];
    expect(next['3']).toEqual([{ start: '09:00', end: '17:00' }]);
    // Tuesday was not working and must not have been opened by the copy.
    expect('2' in next).toBe(false);
  });
});
