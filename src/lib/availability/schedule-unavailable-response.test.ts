import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextResponse } from 'next/server';
import { withScheduleFailClosed } from '@/lib/availability/schedule-unavailable-response';
import { reportAvailabilityReadFailure } from '@/lib/availability/availability-read-failure';

/**
 * Stage 7 (decision J): the rule five guest routes now share.
 *
 * It was copied into each of them, which is the shape that produced the six working-hours
 * implementations Stage 5 collapsed: identical by coincidence and free to drift. Worse,
 * two of the five (`class-instances`, `resource-calendar`) cannot reach a successful
 * response on a venue with no classes or resources, so they could not be proven by
 * exercising the route at all. Testing the shared rule is the only proof available for
 * those two, and it is a better proof than five separate ones for the rest.
 */

const FAILURE = {
  source: 'fetchAppointmentInput',
  table: 'practitioner_leave_periods',
  assumed: 'nobody is on leave, so the day is sold',
};

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('withScheduleFailClosed', () => {
  it('passes a clean success straight through', async () => {
    const res = await withScheduleFailClosed(async () => NextResponse.json({ slots: ['09:00'] }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ slots: ['09:00'] });
  });

  /** The whole point: a body built without one of its inputs must not be served as fact. */
  it('replaces a SUCCESS with 503 when a schedule read failed', async () => {
    const res = await withScheduleFailClosed(async () => {
      reportAvailabilityReadFailure(FAILURE, { message: 'timeout' });
      return NextResponse.json({ slots: [] });
    });

    expect(res.status).toBe(503);
    expect(res.headers.get('Retry-After')).toBe('15');
    expect(res.headers.get('Cache-Control')).toBe('no-store');

    const body = (await res.json()) as { unavailable?: boolean; tables?: string[] };
    expect(body.unavailable).toBe(true);
    expect(body.tables).toEqual(['practitioner_leave_periods']);
  });

  /**
   * A 400 already answers correctly about the REQUEST. Replacing it would turn "you asked
   * for something invalid" into "come back later" -- worse advice, and it would hide a
   * client bug behind an apparent outage.
   */
  it('leaves a 4xx alone even when a read failed', async () => {
    const res = await withScheduleFailClosed(async () => {
      reportAvailabilityReadFailure(FAILURE, { message: 'timeout' });
      return NextResponse.json({ error: 'venue_id is required' }, { status: 400 });
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'venue_id is required' });
  });

  it('leaves a 403 alone, which is how a disabled booking model answers', async () => {
    const res = await withScheduleFailClosed(async () => {
      reportAvailabilityReadFailure(FAILURE, { message: 'timeout' });
      return NextResponse.json({ error: 'not available for this venue' }, { status: 403 });
    });

    expect(res.status).toBe(403);
  });

  it('leaves a 500 alone rather than softening it to a retry', async () => {
    const res = await withScheduleFailClosed(async () => {
      reportAvailabilityReadFailure(FAILURE, { message: 'timeout' });
      return NextResponse.json({ error: 'Server error' }, { status: 500 });
    });

    expect(res.status).toBe(500);
  });

  it('names every failing table once, without duplicates', async () => {
    const res = await withScheduleFailClosed(async () => {
      reportAvailabilityReadFailure(FAILURE, { message: 'a' });
      reportAvailabilityReadFailure(FAILURE, { message: 'b' });
      reportAvailabilityReadFailure({ ...FAILURE, table: 'availability_blocks' }, { message: 'c' });
      return NextResponse.json({ slots: [] });
    });

    const body = (await res.json()) as { tables?: string[] };
    expect(body.tables).toEqual(['practitioner_leave_periods', 'availability_blocks']);
  });

  /** The body reaches an unauthenticated guest, so it must not carry venue identifiers. */
  it('leaks no venue or calendar ids into the guest-visible body', async () => {
    const res = await withScheduleFailClosed(async () => {
      reportAvailabilityReadFailure(
        { ...FAILURE, venueId: 'venue-secret', calendarId: 'cal-secret', date: '2030-01-01' },
        { message: 'timeout' },
      );
      return NextResponse.json({ slots: [] });
    });

    const text = JSON.stringify(await res.json());
    expect(text).not.toContain('venue-secret');
    expect(text).not.toContain('cal-secret');
  });

  it('does not swallow a throw from the handler', async () => {
    await expect(
      withScheduleFailClosed(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });
});
