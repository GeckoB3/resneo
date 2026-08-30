/**
 * P2-2a. What the customer is told BEFORE cancelling a whole course.
 *
 * The acceptance is "the refund outcome stated before confirming", and the
 * failure this guards is a preview that disagrees with the action: a course
 * whose dialog promises three refunds and whose cancellation delivers one is
 * worse than no preview at all, because the customer acted on the promise.
 */
import { describe, it, expect } from 'vitest';
import type { AccountBookingRow } from '@/lib/account/account-bookings';
import {
  courseCancellationLines,
  summariseCourseCancellation,
} from './course-cancellation-summary';

const NOW = '2026-06-01T12:00:00.000Z';

function session(overrides: Partial<AccountBookingRow> = {}): AccountBookingRow {
  return {
    id: 'bk-1',
    venue_id: 'v1',
    guest_id: 'g1',
    booking_date: '2026-06-10',
    booking_time: '18:30:00',
    party_size: 1,
    status: 'Booked',
    booking_model: 'class_session',
    deposit_status: null,
    deposit_amount_pence: null,
    cancellation_deadline: '2026-06-08T12:00:00.000Z',
    group_booking_id: 'grp-1',
    venue: null,
    ...overrides,
  } as AccountBookingRow;
}

describe('summariseCourseCancellation', () => {
  it('counts only the sessions the cancellation would act on', () => {
    const s = summariseCourseCancellation(
      [
        session({ status: 'Booked' }),
        session({ status: 'Confirmed' }),
        session({ status: 'Cancelled' }),
        session({ status: 'Completed' }),
      ],
      NOW,
    );
    expect(s.remaining).toBe(2);
    expect(s.untouched).toBe(2);
  });

  it('splits the sessions on their OWN deadlines, not one shared one', () => {
    // The whole reason this is computed. A course runs for weeks, so part of it
    // is routinely inside the free window and part of it is not.
    const s = summariseCourseCancellation(
      [
        session({ cancellation_deadline: '2026-06-08T12:00:00.000Z' }),
        session({ cancellation_deadline: '2026-05-20T12:00:00.000Z' }),
      ],
      NOW,
    );
    expect(s.beforeDeadline).toBe(1);
    expect(s.afterDeadline).toBe(1);
  });

  it('treats the deadline instant itself as still in time', () => {
    // The action's test is `now <= deadline`. An exclusive comparison here
    // would tell a customer their deposit is lost in the second it is not.
    const s = summariseCourseCancellation([session({ cancellation_deadline: NOW })], NOW);
    expect(s.beforeDeadline).toBe(1);
    expect(s.afterDeadline).toBe(0);
  });

  it('counts a session with no deadline as past one', () => {
    // The action reads a null deadline as not refundable. Guessing the
    // friendlier reading here would promise a refund it will not make.
    const s = summariseCourseCancellation(
      [session({ cancellation_deadline: null, deposit_status: 'Paid', deposit_amount_pence: 500 })],
      NOW,
    );
    expect(s.afterDeadline).toBe(1);
    expect(s.refundablePence).toBe(0);
    expect(s.atRiskPence).toBe(500);
  });

  it('counts a deposit only when it was actually PAID', () => {
    // The action keys strictly on `deposit_status === 'Paid'`; a card hold
    // never reaches it, so an amount on a held booking is not money to return.
    const s = summariseCourseCancellation(
      [
        session({ deposit_status: 'Paid', deposit_amount_pence: 1000 }),
        session({ deposit_status: 'Card Held', deposit_amount_pence: 1500 }),
        session({ deposit_status: 'Pending', deposit_amount_pence: 2000 }),
      ],
      NOW,
    );
    expect(s.refundablePence).toBe(1000);
  });

  it('adds the deposits up across the sessions on each side', () => {
    const s = summariseCourseCancellation(
      [
        session({ deposit_status: 'Paid', deposit_amount_pence: 1000 }),
        session({ deposit_status: 'Paid', deposit_amount_pence: 250 }),
        session({
          deposit_status: 'Paid',
          deposit_amount_pence: 700,
          cancellation_deadline: '2026-05-01T12:00:00.000Z',
        }),
      ],
      NOW,
    );
    expect(s.refundablePence).toBe(1250);
    expect(s.atRiskPence).toBe(700);
  });

  it('survives a deadline that is not a date', () => {
    // The column is free-form enough to hold one, and a NaN comparison is
    // silently false, which would land in the friendlier branch by accident.
    const s = summariseCourseCancellation(
      [session({ cancellation_deadline: 'not a date' as string })],
      NOW,
    );
    expect(s.beforeDeadline + s.afterDeadline).toBe(1);
    expect(s.afterDeadline).toBe(1);
  });
});

describe('courseCancellationLines', () => {
  it('states what stops, what comes back, and what does not', () => {
    const lines = courseCancellationLines(
      summariseCourseCancellation(
        [
          session({ deposit_status: 'Paid', deposit_amount_pence: 1000 }),
          session({
            deposit_status: 'Paid',
            deposit_amount_pence: 700,
            cancellation_deadline: '2026-05-01T12:00:00.000Z',
          }),
        ],
        NOW,
      ),
    );
    expect(lines.join(' ')).toMatch(/2 sessions will be cancelled/);
    expect(lines.join(' ')).toMatch(/£10\.00 of deposits should come back/);
    expect(lines.join(' ')).toMatch(/£7\.00 of deposits will NOT come back/);
    expect(lines.join(' ')).toMatch(/cannot be undone/i);
  });

  it('says nothing about money when there is none at stake', () => {
    // A dialog that mentions refunds on a free course teaches a customer to
    // skim the ones that matter.
    const lines = courseCancellationLines(summariseCourseCancellation([session()], NOW));
    expect(lines.join(' ')).not.toMatch(/£/);
    expect(lines.join(' ')).toMatch(/1 session will be cancelled/);
  });

  it('does not mention sessions it is leaving alone when there are none', () => {
    const lines = courseCancellationLines(summariseCourseCancellation([session()], NOW));
    expect(lines.join(' ')).not.toMatch(/already cancelled or finished/);
  });

  it('says so when part of the course is already gone', () => {
    const lines = courseCancellationLines(
      summariseCourseCancellation([session(), session({ status: 'Cancelled' })], NOW),
    );
    expect(lines.join(' ')).toMatch(/1 session already cancelled or finished/);
  });

  it('gets its singulars and plurals right, because this is money copy', () => {
    const one = courseCancellationLines(summariseCourseCancellation([session()], NOW)).join(' ');
    expect(one).toContain('1 session will be cancelled');
    expect(one).not.toContain('1 sessions');

    const many = courseCancellationLines(
      summariseCourseCancellation([session(), session()], NOW),
    ).join(' ');
    expect(many).toContain('2 sessions will be cancelled');
  });
});
