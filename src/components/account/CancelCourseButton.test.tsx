/** @vitest-environment happy-dom */
/**
 * P2-2a, the browser half. What the customer sees before they commit, and what
 * the browser sends when they do.
 *
 * The consequence lines are computed server-side and covered by
 * `course-cancellation-summary.test.ts`; what is only testable here is that
 * they are actually SHOWN before the request goes, and that confirming sends
 * the course scope rather than a plain cancel. Sending a plain cancel would
 * look identical from every angle except the five sessions still booked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { CancelCourseButton } from './CancelCourseButton';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const LINES = [
  '3 sessions will be cancelled.',
  '£10.00 of deposits should come back, across 2 sessions still inside the free-cancellation window.',
  'This cannot be undone. You would need to book again.',
];

function renderButton(lines = LINES) {
  render(
    <CancelCourseButton anchorBookingId="bk-1" courseName="Reformer Pilates" lines={lines} />,
  );
}

function stubFetch(response: { ok: boolean; body?: unknown }) {
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify(response.body ?? {}), {
      status: response.ok ? 200 : 409,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  refresh.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('CancelCourseButton', () => {
  it('cancels nothing until the customer confirms', async () => {
    // The failure worth ruling out: a one-click destructive action on a list
    // row, where the pointer is already moving down the page.
    const fetchMock = stubFetch({ ok: true });
    renderButton();
    await userEvent.click(screen.getByRole('button', { name: /cancel the whole course/i }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('states every consequence before the confirm button', async () => {
    stubFetch({ ok: true });
    renderButton();
    await userEvent.click(screen.getByRole('button', { name: /cancel the whole course/i }));
    for (const line of LINES) {
      expect(screen.getByText(line), `"${line}" was not shown`).toBeInTheDocument();
    }
  });

  it('names the course, so a customer with two knows which one', async () => {
    stubFetch({ ok: true });
    renderButton();
    await userEvent.click(screen.getByRole('button', { name: /cancel the whole course/i }));
    expect(screen.getByText(/cancel reformer pilates/i)).toBeInTheDocument();
  });

  it('sends the COURSE scope to the booking’s own cancel route', async () => {
    const fetchMock = stubFetch({ ok: true });
    renderButton();
    await userEvent.click(screen.getByRole('button', { name: /cancel the whole course/i }));
    await userEvent.click(screen.getByRole('button', { name: /yes, cancel the course/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/account/bookings/bk-1/cancel');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ scope: 'course' });
  });

  it('reloads the list rather than declaring success itself', async () => {
    // A partial cancellation is a real outcome, so the honest thing to show is
    // the sessions as they now stand. A green tick over a list still showing
    // six live sessions is the one thing worse than the error.
    stubFetch({ ok: true });
    renderButton();
    await userEvent.click(screen.getByRole('button', { name: /cancel the whole course/i }));
    await userEvent.click(screen.getByRole('button', { name: /yes, cancel the course/i }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('shows the server’s reason on the row when it refuses', async () => {
    /*
      `ConfirmDialog` closes itself the moment confirm is pressed, so a message
      inside its body can never be read. Reported on the row instead, where the
      customer is now looking, and as `role="alert"` because the control that
      had focus has gone with the dialog. Silence here would leave them staring
      at an unchanged list not knowing whether anything happened.
    */
    stubFetch({ ok: false, body: { error: 'Every session on this course is already cancelled.' } });
    renderButton();
    await userEvent.click(screen.getByRole('button', { name: /cancel the whole course/i }));
    await userEvent.click(screen.getByRole('button', { name: /yes, cancel the course/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/already cancelled/i);
    expect(refresh, 'it reloaded the list as though something had changed').not.toHaveBeenCalled();
  });

  it('clears a previous failure when the customer tries again', async () => {
    // Otherwise a stale red line sits under a course that has just been
    // cancelled successfully.
    stubFetch({ ok: false, body: { error: 'Already cancelled.' } });
    renderButton();
    await userEvent.click(screen.getByRole('button', { name: /cancel the whole course/i }));
    await userEvent.click(screen.getByRole('button', { name: /yes, cancel the course/i }));
    await screen.findByRole('alert');

    await userEvent.click(screen.getByRole('button', { name: /cancel the whole course/i }));
    // By TEXT, not by role: reopening the dialog marks the rest of the page
    // aria-hidden, so `queryByRole('alert')` returns null whether the message
    // was cleared or not, and the assertion would pass against a stale one.
    expect(screen.queryByText(/already cancelled/i)).not.toBeInTheDocument();
  });

  it('offers a way out that is not the destructive one', async () => {
    stubFetch({ ok: true });
    renderButton();
    await userEvent.click(screen.getByRole('button', { name: /cancel the whole course/i }));
    // "Cancel" as a dismiss label on a cancellation dialog is genuinely
    // ambiguous, which is why this one says what keeping means.
    expect(screen.getByRole('button', { name: /keep my sessions/i })).toBeInTheDocument();
  });
});
