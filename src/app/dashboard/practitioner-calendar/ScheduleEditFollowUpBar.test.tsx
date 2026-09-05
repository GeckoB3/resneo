/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  FOLLOW_UP_BAR_TOAST_OFFSET_VAR,
  ScheduleEditFollowUpBar,
  scheduleEditFollowUpHeadline,
  type ScheduleEditFollowUpChange,
} from './ScheduleEditFollowUpBar';

const MOVE: ScheduleEditFollowUpChange = {
  kind: 'move',
  guestName: 'Sam Jones',
  staffName: null,
  fromDate: '2026-09-08',
  fromTime: '10:00',
  toDate: '2026-09-08',
  toTime: '11:15',
  accent: '#0ea5e9',
};

afterEach(() => {
  cleanup();
  document.documentElement.style.removeProperty(FOLLOW_UP_BAR_TOAST_OFFSET_VAR);
});

describe('scheduleEditFollowUpHeadline', () => {
  it('names the new start for a move on the same day and column', () => {
    expect(scheduleEditFollowUpHeadline(MOVE)).toBe('Moved Sam Jones to 11:15');
  });

  it('adds the day and the staff member when either changed', () => {
    expect(
      scheduleEditFollowUpHeadline({ ...MOVE, toDate: '2026-09-09', staffName: 'Alex' }),
    ).toBe('Moved Sam Jones to 11:15 on Wed 9 Sep with Alex');
  });

  it('describes a resize by its new end', () => {
    expect(
      scheduleEditFollowUpHeadline({ ...MOVE, kind: 'resize', fromTime: '11:00', toTime: '11:30' }),
    ).toBe('Sam Jones now ends at 11:30 (was 11:00)');
  });
});

describe('ScheduleEditFollowUpBar', () => {
  function renderBar(overrides: Partial<Parameters<typeof ScheduleEditFollowUpBar>[0]> = {}) {
    const onNotifyNow = vi.fn();
    const onSkip = vi.fn();
    const onUndo = vi.fn();
    const utils = render(
      <ScheduleEditFollowUpBar
        change={MOVE}
        countdownSec={52}
        disabled={false}
        onNotifyNow={onNotifyNow}
        onSkip={onSkip}
        onUndo={onUndo}
        {...overrides}
      />,
    );
    return { ...utils, onNotifyNow, onSkip, onUndo };
  }

  it('shows the change and the countdown, and routes each button to its handler', () => {
    const { onNotifyNow, onSkip, onUndo } = renderBar();
    expect(screen.getByText('Moved Sam Jones to 11:15')).toBeInTheDocument();
    expect(
      screen.getByText('The customer will be notified in 52s unless you skip or undo.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Notify now' }));
    fireEvent.click(screen.getByRole('button', { name: 'Skip notify' }));
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onNotifyNow).toHaveBeenCalledTimes(1);
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it('asks plainly once the countdown has stopped, and disables the buttons while an undo is saving', () => {
    renderBar({ countdownSec: null, disabled: true });
    expect(screen.getByText('Notify the customer about this change?')).toBeInTheDocument();
    for (const name of ['Notify now', 'Skip notify', 'Undo']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
  });

  it('lifts the toasts above itself while mounted and lets them back down after', () => {
    const { unmount } = renderBar();
    expect(document.documentElement.style.getPropertyValue(FOLLOW_UP_BAR_TOAST_OFFSET_VAR)).toMatch(
      /^\d+px$/,
    );
    unmount();
    expect(document.documentElement.style.getPropertyValue(FOLLOW_UP_BAR_TOAST_OFFSET_VAR)).toBe('');
  });
});
