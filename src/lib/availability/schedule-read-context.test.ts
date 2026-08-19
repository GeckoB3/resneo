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
