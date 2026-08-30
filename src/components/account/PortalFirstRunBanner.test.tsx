/** @vitest-environment happy-dom */
/**
 * P3-4h: the prompt that turns a one-click arrival into a customer who never
 * needs an email again.
 *
 * Two properties carry the weight. It must be a PROMPT and not a gate, because
 * somebody who arrived to check what time their appointment is has to be able
 * to do that and leave. And "not now" must be remembered on the ACCOUNT rather
 * than in the browser, or the same person is asked again on their phone.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { PortalFirstRunBanner } from './PortalFirstRunBanner';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

/** Typed with its argument, so the assertion below can read what was written. */
const updateUser = vi.fn(async (_args?: { data?: Record<string, unknown> }) => ({ error: null }));
vi.mock('@/lib/supabase/browser', () => ({
  createClient: () => ({ auth: { updateUser } }),
}));

function stubFetch(ok = true, body: unknown = {}) {
  const mock = vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status: ok ? 200 : 400,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', mock);
  return mock;
}

beforeEach(() => {
  refresh.mockClear();
  updateUser.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('it is a prompt, not a gate', () => {
  it('is a named region, NOT a heading', () => {
    /*
      It renders in the layout above the page's own `<h1>`, so a heading here
      breaks the document outline on every portal page. It also collided with
      the profile page's "Password" section heading, which
      `portal-navigation.spec.ts` selects by accessible name: the e2e suite
      found that, not this one.
    */
    stubFetch();
    render(<PortalFirstRunBanner />);
    expect(screen.getByRole('region', { name: /set a password/i })).toBeInTheDocument();
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  it('explains what the account IS, which is P3-5’s first-run explainer', () => {
    /*
      Folded in here rather than shipped as a second banner: two dismissible
      boxes above the booking a customer came to read is worse than either
      alone, and they would appear together. What it says is the one thing the
      page in front of them cannot: that this is ONE account across every
      ResNeo venue, not a login for the venue they just booked.
    */
    stubFetch();
    render(<PortalFirstRunBanner />);
    const text = document.body.textContent ?? '';
    expect(text).toMatch(/every booking you make with any ResNeo venue/i);
    /*
      Kept to ONE short paragraph. Written longer it pushed the next booking
      card below the fold at 375px, which P1-2 forbids: the explainer sits
      above the thing the customer actually came for, so its length is part of
      its correctness, not a matter of taste.
    */
    const paragraphs = document.querySelectorAll('section p');
    expect(paragraphs.length, 'the banner grew a paragraph; check P1-2 still passes').toBeLessThanOrEqual(2);
  });

  it('asks without demanding anything', async () => {
    stubFetch();
    render(<PortalFirstRunBanner />);
    expect(screen.getByText(/set a password to get straight back in/i)).toBeInTheDocument();
    // The way out is present before the way in is even expanded.
    expect(screen.getByRole('button', { name: /not now/i })).toBeInTheDocument();
  });

  it('disappears entirely on "not now"', async () => {
    stubFetch();
    render(<PortalFirstRunBanner />);
    await userEvent.click(screen.getByRole('button', { name: /not now/i }));
    expect(screen.queryByText(/set a password to get straight back in/i)).not.toBeInTheDocument();
  });

  it('shows no password fields until the customer asks for them', async () => {
    // A form sitting open above the booking they came to read is a gate with
    // extra steps.
    stubFetch();
    render(<PortalFirstRunBanner />);
    expect(screen.queryByLabelText(/new password/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /set a password/i }));
    expect(screen.getByLabelText(/new password/i)).toBeInTheDocument();
  });
});

describe('"not now" is remembered on the account', () => {
  it('records the dismissal in user metadata, not in this browser', async () => {
    /*
      The plan asks for "genuinely once and not once per device".
      `localStorage` would ask the same customer again on their phone;
      `user_metadata` travels with the account and is what `has_set_password`,
      the other half of this decision, already uses.
    */
    stubFetch();
    render(<PortalFirstRunBanner />);
    await userEvent.click(screen.getByRole('button', { name: /not now/i }));
    await waitFor(() => expect(updateUser).toHaveBeenCalledTimes(1));
    expect(updateUser.mock.calls[0]?.[0]?.data).toHaveProperty(
      'portal_password_prompt_dismissed_at',
    );
  });

  it('hides immediately even if recording the dismissal fails', async () => {
    // The prompt is a nag, not a control. Being asked once more next visit is
    // a far better failure than a button that appears not to work.
    updateUser.mockRejectedValueOnce(new Error('offline'));
    stubFetch();
    render(<PortalFirstRunBanner />);
    await userEvent.click(screen.getByRole('button', { name: /not now/i }));
    expect(screen.queryByText(/set a password to get straight back in/i)).not.toBeInTheDocument();
  });
});

describe('setting a password', () => {
  async function openAndFill(pw: string, confirm = pw) {
    render(<PortalFirstRunBanner />);
    await userEvent.click(screen.getByRole('button', { name: /set a password/i }));
    await userEvent.type(screen.getByLabelText(/new password/i), pw);
    await userEvent.type(screen.getByLabelText(/confirm password/i), confirm);
  }

  it('posts to the route that already exists', async () => {
    // `/api/account/password` is what the profile page uses, and it is what
    // sets `has_set_password`, which is how this prompt stops coming back.
    const fetchMock = stubFetch();
    await openAndFill('a-good-password');
    await userEvent.click(screen.getByRole('button', { name: /save password/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/account/password');
    expect(JSON.parse(String(init.body))).toEqual({ password: 'a-good-password' });
  });

  it('refuses a mismatch without asking the server', async () => {
    const fetchMock = stubFetch();
    await openAndFill('a-good-password', 'a-different-one');
    await userEvent.click(screen.getByRole('button', { name: /save password/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/do not match/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a short password without asking the server', async () => {
    const fetchMock = stubFetch();
    await openAndFill('short');
    await userEvent.click(screen.getByRole('button', { name: /save password/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/8 characters/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows the server’s reason when it refuses', async () => {
    stubFetch(false, { error: 'New password must be different from the current one.' });
    await openAndFill('a-good-password');
    await userEvent.click(screen.getByRole('button', { name: /save password/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/must be different/i);
  });

  it('goes away once the password is saved', async () => {
    stubFetch();
    await openAndFill('a-good-password');
    await userEvent.click(screen.getByRole('button', { name: /save password/i }));
    await waitFor(() =>
      expect(screen.queryByText(/set a password to get straight back in/i)).not.toBeInTheDocument(),
    );
    // And the server state is re-read, so it stays gone on the next render.
    expect(refresh).toHaveBeenCalled();
  });

  it('stays put when the save fails, so the work is not lost', async () => {
    stubFetch(false, { error: 'nope' });
    await openAndFill('a-good-password');
    await userEvent.click(screen.getByRole('button', { name: /save password/i }));
    await screen.findByRole('alert');
    expect(screen.getByLabelText(/new password/i)).toHaveValue('a-good-password');
  });
});
