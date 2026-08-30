/** @vitest-environment happy-dom */
/**
 * P3-4g: the "check your inbox" screen, which is now the way in.
 *
 * With one-click entry bounded to a 24-hour first-entry window, this form is
 * where every returning customer and everyone outside that window arrives. It
 * had two gaps that matter when a link does not turn up, which is the only
 * time anybody looks at it: it did not say WHERE the link went, and it offered
 * no way to send another.
 *
 * The rule it must not break is older than this task and is recorded at
 * `AuthMagicForm.tsx:10-15`: nothing is sent on mount. A transactional email
 * links here, and a single accidental click used to send mail the recipient
 * never asked for.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { AuthMagicForm } from './AuthMagicForm';

vi.mock('@/lib/supabase/browser', () => ({
  createClient: () => ({ auth: { signInWithOtp: async () => ({ error: null }) } }),
}));

function stubSend(opts: { status?: number; retryAfter?: string; body?: unknown } = {}) {
  const mock = vi.fn(async () => {
    const headers = new Headers({ 'Content-Type': 'application/json' });
    if (opts.retryAfter) headers.set('Retry-After', opts.retryAfter);
    return new Response(JSON.stringify(opts.body ?? { ok: true }), {
      status: opts.status ?? 200,
      headers,
    });
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * Run the cooldown down to zero.
 *
 * A SECOND AT A TIME, not one 31-second jump. The countdown schedules the next
 * tick from inside the previous one, so React has to render between them for
 * the next timer to exist at all; a single large advance fires one tick and
 * finds nothing else queued. Fake timers also have to keep advancing real time
 * (`shouldAdvanceTime`), or the `fetch` promises in these tests never settle.
 */
async function runOutCooldown(seconds = 31) {
  for (let i = 0; i < seconds; i += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
  }
}

async function sendFrom(initialEmail = 'guest@example.test') {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(<AuthMagicForm initialEmail={initialEmail} redirect="/account/bookings" />);
  await user.click(screen.getByRole('button', { name: /email me a sign-in link/i }));
  return user;
}

describe('it never sends on mount', () => {
  it('sends nothing until the button is pressed', () => {
    /*
      The oldest rule on this form. A transactional email links here, and an
      accidental click used to send mail to somebody who never asked. Guarded
      because it is the kind of thing a refactor "tidies" back in.
    */
    const fetchMock = stubSend();
    render(<AuthMagicForm initialEmail="guest@example.test" redirect="/account" />);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /email me a sign-in link/i })).toBeInTheDocument();
  });
});

describe('after sending', () => {
  it('NAMES THE ADDRESS the link went to', async () => {
    // "If that email is registered" told a customer who mistyped nothing at
    // all, and going to the wrong address is the commonest reason a link never
    // arrives.
    stubSend();
    await sendFrom('typo@example.test');
    expect(await screen.findByText('typo@example.test')).toBeInTheDocument();
  });

  it('still does not confirm whether the account exists', async () => {
    // Naming the address must not turn this screen into an account oracle.
    stubSend();
    await sendFrom();
    expect(document.body.textContent).toMatch(/if .*is registered/i);
    expect(document.body.textContent).not.toMatch(/no account|not registered|does not exist/i);
  });

  it('states the lifetime from the shared constant', async () => {
    // It used to be written here as well as in the email, which is how two
    // strings about one setting come to disagree.
    stubSend();
    await sendFrom();
    expect(screen.getByText(/expires in 24 hours/i)).toBeInTheDocument();
  });

  it('offers a resend rather than making them start again', async () => {
    stubSend();
    await sendFrom();
    expect(screen.getByRole('button', { name: /resend in|send it again/i })).toBeInTheDocument();
  });
});

describe('the cooldown', () => {
  it('holds the resend closed at first, then opens it', async () => {
    stubSend();
    await sendFrom();
    expect(screen.getByRole('button', { name: /resend in \d+s/i })).toBeDisabled();

    await runOutCooldown();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /send it again/i })).toBeEnabled(),
    );
  });

  it('sends again once it opens, to the same address', async () => {
    const fetchMock = stubSend();
    const user = await sendFrom('guest@example.test');
    await runOutCooldown();
    await user.click(await screen.findByRole('button', { name: /send it again/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const body = JSON.parse(String((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body));
    expect(body.email).toBe('guest@example.test');
  });

  it('takes its length from the server’s OWN Retry-After', async () => {
    /*
      The route allows 3 per address per 15 minutes and returns the real
      remaining time. Guessing a number here would either promise a resend the
      server then refuses, or make the customer wait longer than they need to.
    */
    stubSend({ status: 429, retryAfter: '240' });
    render(<AuthMagicForm initialEmail="guest@example.test" redirect="/account" />);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByRole('button', { name: /email me a sign-in link/i }));
    /*
      A FIRST attempt that is throttled never reaches "check your inbox", so
      the countdown has to bind to the form's own button. Otherwise the
      server's remaining time was recorded and shown to nobody, and the button
      invited a press that would be refused.
    */
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: /try again in \d+s/i });
    expect(button).toBeDisabled();
    expect(button.textContent).toMatch(/2[34]\ds/);
  });

  it('falls back to a sane wait when the server sends no header', async () => {
    stubSend({ status: 429 });
    render(<AuthMagicForm initialEmail="guest@example.test" redirect="/account" />);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByRole('button', { name: /email me a sign-in link/i }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});

describe('changing address', () => {
  it('goes back to the form and clears the wait', async () => {
    // A customer who mistyped should not be held behind a cooldown that
    // belongs to an address they are abandoning.
    stubSend();
    const user = await sendFrom();
    await user.click(screen.getByRole('button', { name: /use a different email/i }));
    expect(screen.getByRole('button', { name: /email me a sign-in link/i })).toBeEnabled();
  });
});
