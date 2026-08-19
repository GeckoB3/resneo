import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withScheduleReadContext } from '@/lib/availability/schedule-read-context';
import { reportAvailabilityReadFailure } from '@/lib/availability/availability-read-failure';

/**
 * Stage 7 (decision J): a guest-facing route learning that the answer it is about to return
 * was built without one of its inputs.
 *
 * The behaviour under test is the collection, not the HTTP shape. What makes it worth
 * trusting is that it hooks the reporter all 44 fail-open read sites ALREADY call, so a site
 * nobody remembers to update cannot silently keep failing open.
 */

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

const FAILURE = {
  source: 'fetchAppointmentInput',
  table: 'practitioner_leave_periods',
  assumed: 'nobody is on leave, so the day is sold',
  venueId: 'v1',
};

describe('withScheduleReadContext', () => {
  it('reports no failures when every read succeeds', async () => {
    const out = await withScheduleReadContext(async () => 'slots');

    expect(out.result).toBe('slots');
    expect(out.failures).toEqual([]);
  });

  it('collects a failure reported anywhere inside the call', async () => {
    const out = await withScheduleReadContext(async () => {
      reportAvailabilityReadFailure(FAILURE, { message: 'timeout' });
      return 'slots';
    });

    expect(out.failures).toHaveLength(1);
    expect(out.failures[0]!.table).toBe('practitioner_leave_periods');
    expect(out.failures[0]!.assumed).toContain('nobody is on leave');
  });

  it('collects failures reported deep in nested async work', async () => {
    const inner = async () => {
      await Promise.resolve();
      reportAvailabilityReadFailure(FAILURE, { message: 'timeout' });
    };

    const out = await withScheduleReadContext(async () => {
      await Promise.all([inner(), inner()]);
      return null;
    });

    expect(out.failures).toHaveLength(2);
  });

  /** The result is untouched: this observes, it does not change what the engine returns. */
  it('does not alter the result or swallow a throw', async () => {
    const ok = await withScheduleReadContext(async () => ({ slots: ['09:00'] }));
    expect(ok.result).toEqual({ slots: ['09:00'] });

    await expect(
      withScheduleReadContext(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });

  /**
   * Isolation matters: one request failing must not make a concurrent one report a failure
   * it never had, which would take a healthy venue offline alongside a broken one.
   */
  it('keeps concurrent contexts separate', async () => {
    const failing = withScheduleReadContext(async () => {
      await Promise.resolve();
      reportAvailabilityReadFailure(FAILURE, { message: 'timeout' });
      return 'a';
    });
    const healthy = withScheduleReadContext(async () => {
      await Promise.resolve();
      return 'b';
    });

    const [f, h] = await Promise.all([failing, healthy]);

    expect(f.failures).toHaveLength(1);
    expect(h.failures).toEqual([]);
  });

  /** Reporting outside a context must stay harmless: every non-guest path still does this. */
  it('does not throw when a failure is reported with no context active', () => {
    expect(() => reportAvailabilityReadFailure(FAILURE, { message: 'timeout' })).not.toThrow();
  });
});

/**
 * Nesting, pinned because a design depends on it and the failure mode is silent.
 *
 * `venue/waitlist` degrades PER ENTRY: it runs each entry's availability check in its own
 * context and blanks that entry's `can_offer` when a read failed, instead of failing the
 * whole response closed. That only works because the collector reads
 * `AsyncLocalStorage.getStore()`, which returns the innermost store.
 *
 * The consequence is the part worth guarding: a route-level `withScheduleFailClosed` added
 * on top of per-entry contexts is NOT additive. It cannot see the failures the inner
 * contexts captured, so it returns a clean 200 and reads as protection while protecting
 * nothing — except for reads outside the loop, which it still converts to 503s. Partial and
 * unpredictable, and a handler-level injection fixture (the style Stage 7 used, `[R3-91]`)
 * cannot tell the difference.
 *
 * If anyone ever changes the listener to broadcast to every active context, these fixtures
 * go red, and they should: that would silently re-arm the outer wrapper and start returning
 * 503s from the waitlist screen.
 */
describe('nested contexts', () => {
  it('the inner context captures the failure and the outer sees nothing', async () => {
    const outer = await withScheduleReadContext(async () => {
      const inner = await withScheduleReadContext(async () => {
        reportAvailabilityReadFailure(FAILURE, { message: 'timeout' });
        return 'entry-result';
      });
      return inner;
    });

    expect(outer.failures).toEqual([]);
    expect(outer.result.failures).toHaveLength(1);
    expect(outer.result.result).toBe('entry-result');
  });

  it('a failure OUTSIDE the inner run is still seen by the outer: the protection is partial', async () => {
    const outer = await withScheduleReadContext(async () => {
      reportAvailabilityReadFailure({ ...FAILURE, table: 'outside_loop' }, { message: 'timeout' });
      await withScheduleReadContext(async () => {
        reportAvailabilityReadFailure({ ...FAILURE, table: 'inside_loop' }, { message: 'timeout' });
      });
      return null;
    });

    expect(outer.failures.map((f) => f.table)).toEqual(['outside_loop']);
  });

  /** What makes per-entry attribution possible: interleaved entries do not pool their failures. */
  it('concurrent per-entry contexts attribute failures to the right entry', async () => {
    const results = await Promise.all(
      [
        { key: 'a', delay: 20, fails: true },
        { key: 'b', delay: 5, fails: false },
        { key: 'c', delay: 10, fails: true },
      ].map((entry) =>
        withScheduleReadContext(async () => {
          await new Promise((resolve) => setTimeout(resolve, entry.delay));
          if (entry.fails) reportAvailabilityReadFailure({ ...FAILURE, table: entry.key }, { message: 'x' });
          return entry.key;
        }),
      ),
    );

    expect(results.map((r) => ({ entry: r.result, failed: r.failures.length > 0 }))).toEqual([
      { entry: 'a', failed: true },
      { entry: 'b', failed: false },
      { entry: 'c', failed: true },
    ]);
  });
});
