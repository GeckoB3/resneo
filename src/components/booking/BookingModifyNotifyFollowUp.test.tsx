/** @vitest-environment happy-dom */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { BookingModifyNotifyFollowUp } from './BookingModifyNotifyFollowUp';

const fetchMock = vi.fn();

const CHANGE = {
  fromDate: '2026-08-12',
  fromTime: '11:15',
  toDate: '2026-08-12',
  toTime: '14:00',
};

function renderFollowUp(over: Partial<Parameters<typeof BookingModifyNotifyFollowUp>[0]> = {}) {
  return render(
    <BookingModifyNotifyFollowUp
      bookingId="b1"
      change={CHANGE}
      onUndo={over.onUndo ?? vi.fn(async () => true)}
      onClose={over.onClose ?? vi.fn()}
      deferMs={over.deferMs ?? 60_000}
    />,
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ emailSent: true, smsSent: false, skipped: false }),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('BookingModifyNotifyFollowUp', () => {
  it('shows the change summary with a notify countdown and the three choices', () => {
    renderFollowUp();
    expect(screen.getByText(/Moved from 11:15 on Wed 12 Aug to 14:00 on Wed 12 Aug/)).toBeInTheDocument();
    expect(screen.getByText(/notified in 60s unless you skip or undo/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Notify now' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Skip notify' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo change' })).toBeInTheDocument();
  });

  it('Notify now posts the notification and shows the result', async () => {
    renderFollowUp();
    screen.getByRole('button', { name: 'Notify now' }).click();
    await waitFor(() => {
      expect(screen.getByText('Update sent by email.')).toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/venue/bookings/b1/guest-modification-notify', {
      method: 'POST',
    });
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
  });

  it('Skip notify closes without ever posting, including on unmount', () => {
    const onClose = vi.fn();
    const { unmount } = renderFollowUp({ onClose });
    screen.getByRole('button', { name: 'Skip notify' }).click();
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Undo runs the revert, closes, and never notifies', async () => {
    const onUndo = vi.fn(async () => true);
    const onClose = vi.fn();
    const { unmount } = renderFollowUp({ onUndo, onClose });
    screen.getByRole('button', { name: 'Undo change' }).click();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onUndo).toHaveBeenCalledTimes(1);
    unmount();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a failed undo keeps the panel open with an error and stops the countdown', async () => {
    const onUndo = vi.fn(async () => false);
    const onClose = vi.fn();
    renderFollowUp({ onUndo, onClose });
    screen.getByRole('button', { name: 'Undo change' }).click();
    await waitFor(() => {
      expect(screen.getByText(/Could not undo the change/)).toBeInTheDocument();
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('Notify the customer about this change?')).toBeInTheDocument();
  });

  it('the countdown expiry sends the notification automatically (calendar parity)', async () => {
    vi.useFakeTimers();
    renderFollowUp({ deferMs: 2000 });
    await vi.advanceTimersByTimeAsync(2100);
    expect(fetchMock).toHaveBeenCalledWith('/api/venue/bookings/b1/guest-modification-notify', {
      method: 'POST',
    });
  });

  it('dismissing without choosing fires the notification on unmount', () => {
    const { unmount } = renderFollowUp();
    unmount();
    expect(fetchMock).toHaveBeenCalledWith('/api/venue/bookings/b1/guest-modification-notify', {
      method: 'POST',
    });
  });
});
