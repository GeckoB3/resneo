/** @vitest-environment happy-dom */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { StrictMode } from 'react';
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

afterEach(async () => {
  // Real timers first: the flush below waits on a real macrotask, and a test
  // that installed fake timers would never resolve it.
  vi.useRealTimers();
  cleanup();
  // The dismissal send is scheduled, not inline, so let it land here rather
  // than in the next test's mock.
  await new Promise((r) => setTimeout(r, 0));
  vi.unstubAllGlobals();
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

  it('dismissing without choosing fires the notification on unmount', async () => {
    const { unmount } = renderFollowUp();
    unmount();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).toHaveBeenCalledWith('/api/venue/bookings/b1/guest-modification-notify', {
      method: 'POST',
    });
  });
});

/**
 * React StrictMode mounts, tears down and immediately remounts every component
 * once in development, preserving refs across that remount. The dismissal
 * fallback used to fire inline on teardown and mark the panel settled, so by the
 * time staff saw it every button was a no-op and the guest had already been
 * notified. Only the modal's own close button still did anything, which is
 * exactly how it was reported.
 */
describe('survives a StrictMode double mount', () => {
  function renderStrict(over: Partial<Parameters<typeof BookingModifyNotifyFollowUp>[0]> = {}) {
    return render(
      <StrictMode>
        <BookingModifyNotifyFollowUp
          bookingId="b1"
          change={CHANGE}
          onUndo={over.onUndo ?? vi.fn(async () => true)}
          onClose={over.onClose ?? vi.fn()}
          deferMs={over.deferMs ?? 60_000}
        />
      </StrictMode>,
    );
  }

  it('does not notify the guest just for mounting', async () => {
    renderStrict();
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Skip notify still closes the panel', async () => {
    const onClose = vi.fn();
    renderStrict({ onClose });
    await new Promise((r) => setTimeout(r, 10));
    screen.getByRole('button', { name: 'Skip notify' }).click();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Undo change still runs the revert', async () => {
    const onUndo = vi.fn(async () => true);
    const onClose = vi.fn();
    renderStrict({ onUndo, onClose });
    await new Promise((r) => setTimeout(r, 10));
    screen.getByRole('button', { name: 'Undo change' }).click();
    await waitFor(() => expect(onUndo).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('Notify now still sends and shows the result', async () => {
    renderStrict();
    await new Promise((r) => setTimeout(r, 10));
    screen.getByRole('button', { name: 'Notify now' }).click();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/venue/bookings/b1/guest-modification-notify', {
        method: 'POST',
      }),
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument());
  });
});
