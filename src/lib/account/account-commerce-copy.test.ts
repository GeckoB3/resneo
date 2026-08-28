import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  COURSE_LABELS,
  CREDIT_REASON_LABELS,
  MEMBERSHIP_LABELS,
  RECURRING_LABELS,
  formatAccountDate,
  friendlyCourseStatus,
  friendlyCreditReason,
  friendlyMembershipStatus,
  friendlyRecurringStatus,
  membershipStandingLine,
} from '@/lib/account/account-commerce-copy';

/**
 * P1-4. These are the states the e2e fixture cannot produce.
 *
 * `portal-copy.spec.ts` greps the real DOM, but the fixture customer has no
 * membership, so no run of it will ever render `past_due` or `incomplete`. The
 * enum values here come from the migration, and the last test in this file
 * reads that migration to check nothing has been added since.
 */

describe('membership status', () => {
  it('never shows a customer a stored value', () => {
    for (const status of ['trialing', 'active', 'past_due', 'canceled', 'paused', 'incomplete']) {
      const label = friendlyMembershipStatus(status);
      expect(label, status).not.toContain('_');
      expect(label, status).not.toBe(status);
    }
  });

  it('says what happened, for the two that alarm people', () => {
    // "past due" is an accounting phrase that tells a customer nothing about
    // what to do; "incomplete" reads as though they did something wrong.
    expect(friendlyMembershipStatus('past_due')).toBe('Payment failed');
    expect(friendlyMembershipStatus('incomplete')).toBe('Setting up');
  });

  it('falls back to a plain word, not to the raw value', () => {
    // Deliberately unlike `friendlyAccountBookingStatus`, which passes unknown
    // values through. A value this module has not seen is by construction a
    // snake_case identifier, and passing it through is the defect.
    expect(friendlyMembershipStatus('incomplete_expired')).not.toContain('_');
    expect(friendlyMembershipStatus(null)).not.toContain('_');
    expect(friendlyMembershipStatus('')).not.toContain('_');
  });
});

describe('the other three enums', () => {
  it('map every stored value to something readable', () => {
    const cases: Array<[string[], (v: string) => string]> = [
      [['pending_payment', 'active', 'cancelled', 'completed'], friendlyCourseStatus],
      [['active', 'paused', 'cancelled', 'failed'], friendlyRecurringStatus],
      [['purchase', 'redeem', 'refund', 'expire', 'admin_adjust'], friendlyCreditReason],
    ];
    for (const [values, fn] of cases) {
      for (const value of values) {
        expect(fn(value), value).not.toContain('_');
      }
    }
  });

  it('uses the same phrase as the bookings list for the same situation', () => {
    // A customer should meet one wording for "we are waiting on your payment",
    // not one per section.
    expect(friendlyCourseStatus('pending_payment')).toBe('Awaiting payment');
  });

  it('does not call a customer action an admin adjustment', () => {
    expect(friendlyCreditReason('admin_adjust')).toBe('Adjusted by the venue');
    expect(friendlyCreditReason('redeem')).toBe('Used');
  });
});

describe('dates', () => {
  it('reads as a date, not as a database value', () => {
    expect(formatAccountDate('2026-09-04')).toBe('4 September 2026');
    expect(formatAccountDate('2026-09-04T23:30:00.000Z')).toBe('4 September 2026');
  });

  it('does not slip a day for a viewer west of UTC', () => {
    // The bug this guards: `new Date('2026-09-04')` is UTC midnight, so
    // formatting it in the viewer's local zone shows 3 September in New York.
    // These dates carry no time and no venue, so UTC is the only defensible
    // reading, and the function pins it.
    const original = process.env.TZ;
    try {
      process.env.TZ = 'America/Los_Angeles';
      expect(formatAccountDate('2026-09-04')).toBe('4 September 2026');
    } finally {
      process.env.TZ = original;
    }
  });

  it('returns null rather than printing Invalid Date', () => {
    for (const bad of [null, undefined, '', 'soon', 'not-a-date', '2026-13-45']) {
      const out = formatAccountDate(bad);
      expect(out === null || !out.includes('Invalid'), String(bad)).toBe(true);
    }
    expect(formatAccountDate('2026-13-45')).toBeNull();
  });
});

describe('the membership standing line', () => {
  it('does not say a cancelled membership renews', () => {
    // What it used to print: "active · renews 2026-09-04 · cancelling". Two
    // facts that contradict each other, leaving the customer to work out which
    // one wins.
    const line = membershipStandingLine({
      status: 'active',
      current_period_end: '2026-09-04',
      cancel_at_period_end: true,
    });
    expect(line).toBe('Active, ends 4 September 2026');
    expect(line).not.toContain('renews');
  });

  it('says it renews when it really does', () => {
    expect(
      membershipStandingLine({
        status: 'active',
        current_period_end: '2026-09-04',
        cancel_at_period_end: false,
      }),
    ).toBe('Active, renews 4 September 2026');
  });

  it('drops the date rather than printing half a sentence', () => {
    expect(membershipStandingLine({ status: 'paused', current_period_end: null })).toBe('Paused');
    expect(membershipStandingLine({ status: 'past_due' })).toBe('Payment failed');
  });
});

describe('the enum lists have not drifted from the database', () => {
  it('covers every value the migration defines', () => {
    // The maps in this module are typed as exhaustive `Record`s, so a value
    // added to the TYPE without wording is a build error. This catches the
    // other direction: a value added to the DATABASE that the type never
    // learned about, which TypeScript cannot see.
    const sql = fs.readFileSync(
      path.join(
        process.cwd(),
        'supabase',
        'migrations',
        '20260701120000_class_commerce_foundation.sql',
      ),
      'utf8',
    );

    const enumValues = (typeName: string): string[] => {
      const m = sql.match(new RegExp(`CREATE TYPE public\\.${typeName} AS ENUM \\(([^)]*)\\)`));
      expect(m, `${typeName} not found in the migration`).toBeTruthy();
      return [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    };

    const checks: Array<[string, Record<string, string>]> = [
      ['class_membership_status', MEMBERSHIP_LABELS],
      ['class_course_enrollment_status', COURSE_LABELS],
      ['class_recurring_reservation_status', RECURRING_LABELS],
      ['class_credit_ledger_reason', CREDIT_REASON_LABELS],
    ];

    for (const [typeName, labels] of checks) {
      const values = enumValues(typeName);
      expect(values.length, `${typeName} parsed as empty`).toBeGreaterThan(3);
      // Compared against the KEYS, not against what the functions return. The
      // first version of this called the functions, which cannot see a missing
      // key at all: an unmapped value falls back to a perfectly clean label, so
      // the check passed on a drifted enum. A mutation removing `past_due`
      // found that, and this is the fix.
      expect(Object.keys(labels).sort(), `${typeName} has drifted`).toEqual([...values].sort());
      for (const value of values) {
        expect(labels[value], `${typeName}.${value} leaks a stored value`).not.toContain('_');
      }
    }
  });
});
