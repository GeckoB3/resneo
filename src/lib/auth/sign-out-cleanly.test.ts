import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted so the vi.mock factory can reference the spy before imports run.
const { signOutMock } = vi.hoisted(() => ({ signOutMock: vi.fn() }));

vi.mock('@/lib/supabase/browser', () => ({
  createClient: () => ({ auth: { signOut: signOutMock } }),
}));

import { signOutCleanly } from './sign-out-cleanly';

describe('signOutCleanly', () => {
  let replace: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    replace = vi.fn();
    // `caches` is left undefined (node env) so the cache-purge block is skipped.
    vi.stubGlobal('window', { location: { replace } });
    signOutMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('hard-navigates to the signed-out route once the client sign-out resolves', async () => {
    signOutMock.mockResolvedValue({ error: null });

    await signOutCleanly('/login');

    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith('/auth/signed-out?next=%2Flogin');
  });

  it('still navigates when the client sign-out hangs (flaky mobile network)', async () => {
    // A /logout request whose response never arrives — the exact mobile failure
    // that used to leave the button doing nothing until a manual refresh.
    signOutMock.mockReturnValue(new Promise(() => {}));

    const pending = signOutCleanly('/login');

    // Before the timeout elapses, the redirect must not have fired yet...
    await vi.advanceTimersByTimeAsync(1499);
    expect(replace).not.toHaveBeenCalled();

    // ...but once the best-effort budget is spent, we navigate regardless.
    await vi.advanceTimersByTimeAsync(1);
    await pending;

    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith('/auth/signed-out?next=%2Flogin');
  });

  it('still navigates when the client sign-out rejects', async () => {
    signOutMock.mockRejectedValue(new Error('network down'));

    await signOutCleanly('/login');

    expect(replace).toHaveBeenCalledWith('/auth/signed-out?next=%2Flogin');
  });

  it('encodes the next path into the signed-out URL', async () => {
    signOutMock.mockResolvedValue({ error: null });

    await signOutCleanly('/dashboard/settings?tab=linked-accounts');

    expect(replace).toHaveBeenCalledWith(
      '/auth/signed-out?next=%2Fdashboard%2Fsettings%3Ftab%3Dlinked-accounts',
    );
  });
});
