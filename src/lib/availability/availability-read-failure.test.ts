import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  reportAvailabilityReadFailure,
  reportAvailabilityReadFailures,
} from './availability-read-failure';

const captureException = vi.hoisted(() => vi.fn());
vi.mock('@sentry/nextjs', () => ({ captureException }));

const CONTEXT = {
  source: 'fetchAppointmentInput',
  table: 'practitioner_leave_periods',
  assumed: 'nobody is on leave',
  venueId: 'venue-1',
  date: '2026-09-01',
};

describe('reportAvailabilityReadFailure', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    captureException.mockClear();
    delete process.env.SENTRY_DSN;
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
  });

  afterEach(() => {
    warn.mockRestore();
    delete process.env.SENTRY_DSN;
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
  });

  it('preserves the existing warning format so log greps keep working', () => {
    reportAvailabilityReadFailure(CONTEXT, { message: 'connection reset' });

    expect(warn).toHaveBeenCalledWith(
      '[fetchAppointmentInput] practitioner_leave_periods: connection reset',
    );
  });

  it('warns with a placeholder when the error carries no message', () => {
    reportAvailabilityReadFailure(CONTEXT, null);

    expect(warn).toHaveBeenCalledWith(
      '[fetchAppointmentInput] practitioner_leave_periods: unknown error',
    );
  });

  it('does not reach for Sentry when no DSN is configured', async () => {
    reportAvailabilityReadFailure(CONTEXT, { message: 'connection reset' });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(captureException).not.toHaveBeenCalled();
  });

  it('reports to Sentry with the site fingerprint and the assumption made', async () => {
    process.env.SENTRY_DSN = 'https://example.invalid/1';

    reportAvailabilityReadFailure(CONTEXT, {
      message: 'connection reset',
      code: '57P01',
      details: 'terminating connection',
      hint: null,
    });

    await vi.waitFor(() => expect(captureException).toHaveBeenCalledTimes(1));

    const [error, options] = captureException.mock.calls[0] as [
      Error,
      {
        level: string;
        tags: Record<string, string>;
        fingerprint: string[];
        extra: Record<string, unknown>;
      },
    ];

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe(
      'Availability read failed: practitioner_leave_periods (connection reset)',
    );
    expect(options.level).toBe('error');
    expect(options.fingerprint).toEqual([
      'availability-read-failure',
      'fetchAppointmentInput',
      'practitioner_leave_periods',
    ]);
    expect(options.tags).toEqual({
      availability_read_source: 'fetchAppointmentInput',
      availability_read_table: 'practitioner_leave_periods',
    });
    expect(options.extra).toMatchObject({
      assumed: 'nobody is on leave',
      venueId: 'venue-1',
      date: '2026-09-01',
      code: '57P01',
      details: 'terminating connection',
      hint: null,
    });
  });

  it('accepts NEXT_PUBLIC_SENTRY_DSN as the sibling config does', async () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://example.invalid/2';

    reportAvailabilityReadFailure(CONTEXT, { message: 'connection reset' });

    await vi.waitFor(() => expect(captureException).toHaveBeenCalledTimes(1));
  });

  it('never throws when Sentry itself fails', async () => {
    process.env.SENTRY_DSN = 'https://example.invalid/1';
    captureException.mockImplementationOnce(() => {
      throw new Error('sentry is down');
    });

    expect(() => reportAvailabilityReadFailure(CONTEXT, { message: 'boom' })).not.toThrow();

    // The rejection is swallowed inside the helper rather than surfacing here.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});

describe('reportAvailabilityReadFailures', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    delete process.env.SENTRY_DSN;
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('reports only the reads that failed', () => {
    reportAvailabilityReadFailures(
      'fetchAppointmentInput',
      { venueId: 'venue-1', date: '2026-09-01' },
      [
        { table: 'bookings', assumed: 'nothing is booked', error: { message: 'timeout' } },
        { table: 'practitioner_leave_periods', assumed: 'nobody is on leave', error: null },
        { table: 'availability_blocks', assumed: 'no closures', error: { message: 'timeout' } },
      ],
    );

    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith('[fetchAppointmentInput] bookings: timeout');
    expect(warn).toHaveBeenCalledWith('[fetchAppointmentInput] availability_blocks: timeout');
  });

  it('reports nothing when every read succeeded', () => {
    reportAvailabilityReadFailures('fetchAppointmentInput', { venueId: 'venue-1' }, [
      { table: 'bookings', assumed: 'nothing is booked', error: null },
    ]);

    expect(warn).not.toHaveBeenCalled();
  });
});
