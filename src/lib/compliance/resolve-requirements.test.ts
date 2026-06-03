import { describe, expect, it } from 'vitest';
import {
  bookingDatetime,
  isBlocking,
  isRecordValidForBooking,
  resolveRequirement,
  resolveRequirements,
  summariseBlocking,
  type ResolverRecord,
  type ResolverRequirement,
} from '@/lib/compliance/resolve-requirements';
import type { ComplianceEnforcement } from '@/lib/compliance/constants';

const NOW = new Date('2026-06-01T12:00:00Z');
const BOOKING = new Date('2026-06-10T14:00:00Z');

function req(overrides: Partial<ResolverRequirement> = {}): ResolverRequirement {
  return {
    id: 'req1',
    compliance_type_id: 'type1',
    compliance_type_name: 'PPD Patch Test',
    enforcement: 'block_all',
    lock_period_hours: null,
    type_is_active: true,
    ...overrides,
  };
}

function rec(overrides: Partial<ResolverRecord> = {}): ResolverRecord {
  return {
    id: 'rec1',
    compliance_type_id: 'type1',
    status: 'completed',
    expires_at: new Date('2026-12-01T00:00:00Z'),
    voided_at: null,
    captured_at: new Date('2026-05-01T10:00:00Z'),
    result: 'pass',
    captured_by_staff_id: 'staff1',
    ...overrides,
  };
}

describe('isRecordValidForBooking', () => {
  it('valid when completed, unexpired, not voided, no lock', () => {
    expect(isRecordValidForBooking(rec(), BOOKING, null)).toBe(true);
  });
  it('invalid when voided', () => {
    expect(isRecordValidForBooking(rec({ voided_at: NOW }), BOOKING, null)).toBe(false);
  });
  it('invalid when status not completed', () => {
    expect(isRecordValidForBooking(rec({ status: 'expired' }), BOOKING, null)).toBe(false);
  });
  it('invalid when expires on/before the booking', () => {
    expect(isRecordValidForBooking(rec({ expires_at: new Date('2026-06-10T14:00:00Z') }), BOOKING, null)).toBe(
      false,
    );
    expect(isRecordValidForBooking(rec({ expires_at: new Date('2026-06-09T00:00:00Z') }), BOOKING, null)).toBe(
      false,
    );
  });
  it('valid with null expiry (lifetime)', () => {
    expect(isRecordValidForBooking(rec({ expires_at: null }), BOOKING, null)).toBe(true);
  });
  it('respects the lock-period window (§4.5.1)', () => {
    // Booking is 2026-06-10T14:00Z. A 48h lock requires capture <= 2026-06-08T14:00Z.
    const captured12hBefore = rec({ captured_at: new Date('2026-06-10T02:00:00Z') });
    expect(isRecordValidForBooking(captured12hBefore, BOOKING, 48)).toBe(false);
    const capturedWeekBefore = rec({ captured_at: new Date('2026-06-01T10:00:00Z') });
    expect(isRecordValidForBooking(capturedWeekBefore, BOOKING, 48)).toBe(true);
  });
});

describe('resolveRequirement', () => {
  it('SATISFIED with a valid, not-soon-expiring record', () => {
    const r = resolveRequirement(req(), [rec()], BOOKING, NOW);
    expect(r.state).toBe('satisfied');
    expect(r.matchingRecord?.id).toBe('rec1');
  });

  it('EXPIRING_SOON when valid but expires within 30 days of now', () => {
    const r = resolveRequirement(req(), [rec({ expires_at: new Date('2026-06-20T00:00:00Z') })], BOOKING, NOW);
    expect(r.state).toBe('expiring_soon');
    expect(r.matchingRecord).not.toBeNull();
  });

  it('MISSING when the guest has no record of this type', () => {
    const r = resolveRequirement(req(), [], BOOKING, NOW);
    expect(r.state).toBe('missing');
    expect(r.latestRecord).toBeNull();
  });

  it('EXPIRED when a record exists but none are valid', () => {
    const r = resolveRequirement(req(), [rec({ status: 'expired', expires_at: new Date('2026-05-15T00:00:00Z') })], BOOKING, NOW);
    expect(r.state).toBe('expired');
    expect(r.latestRecord).not.toBeNull();
  });

  it('picks the most recent valid record when several exist', () => {
    const older = rec({ id: 'old', captured_at: new Date('2026-04-01T00:00:00Z') });
    const newer = rec({ id: 'new', captured_at: new Date('2026-05-20T00:00:00Z') });
    const r = resolveRequirement(req(), [older, newer], BOOKING, NOW);
    expect(r.matchingRecord?.id).toBe('new');
  });

  it('flags lockBlocked when only failure is the lock window', () => {
    const tooClose = rec({ captured_at: new Date('2026-06-10T02:00:00Z') });
    const r = resolveRequirement(req({ lock_period_hours: 48 }), [tooClose], BOOKING, NOW);
    expect(r.state).toBe('expired'); // not valid for the booking
    expect(r.lockBlocked).toBe(true);
  });

  it('does not flag lockBlocked when the record is also expired', () => {
    const expiredAndClose = rec({
      captured_at: new Date('2026-06-10T02:00:00Z'),
      expires_at: new Date('2026-06-09T00:00:00Z'),
    });
    const r = resolveRequirement(req({ lock_period_hours: 48 }), [expiredAndClose], BOOKING, NOW);
    expect(r.lockBlocked).toBe(false);
  });
});

describe('resolveRequirements groups records by type', () => {
  it('matches each requirement to its own type records', () => {
    const reqs = [req({ id: 'r1', compliance_type_id: 't1' }), req({ id: 'r2', compliance_type_id: 't2' })];
    const records = [
      rec({ id: 'a', compliance_type_id: 't1' }),
      // t2 has no records → missing
    ];
    const resolved = resolveRequirements(reqs, records, BOOKING, NOW);
    expect(resolved.find((r) => r.requirement.id === 'r1')?.state).toBe('satisfied');
    expect(resolved.find((r) => r.requirement.id === 'r2')?.state).toBe('missing');
  });
});

describe('isBlocking', () => {
  const cases: Array<[ComplianceEnforcement, 'online' | 'staff', boolean]> = [
    ['warn_staff', 'online', false],
    ['warn_staff', 'staff', false],
    ['warn_client', 'online', false],
    ['block_online', 'online', true],
    ['block_online', 'staff', false],
    ['block_all', 'online', true],
    ['block_all', 'staff', true],
  ];
  it.each(cases)('%s in %s context → blocking=%s (for MISSING)', (enforcement, context, expected) => {
    expect(isBlocking('missing', enforcement, context)).toBe(expected);
  });

  it('never blocks when satisfied or expiring_soon', () => {
    expect(isBlocking('satisfied', 'block_all', 'online')).toBe(false);
    expect(isBlocking('expiring_soon', 'block_all', 'online')).toBe(false);
  });
});

describe('summariseBlocking', () => {
  it('collects unmet blocking requirements', () => {
    const resolved = resolveRequirements(
      [
        req({ id: 'r1', compliance_type_id: 't1', enforcement: 'block_all' }),
        req({ id: 'r2', compliance_type_id: 't2', enforcement: 'warn_client' }),
        req({ id: 'r3', compliance_type_id: 't3', enforcement: 'block_online' }),
      ],
      [], // all missing
      BOOKING,
      NOW,
    );
    const online = summariseBlocking(resolved, 'online');
    expect(online.blocked).toBe(true);
    expect(online.unmet.map((u) => u.compliance_type_id).sort()).toEqual(['t1', 't3']);

    const staff = summariseBlocking(resolved, 'staff');
    expect(staff.unmet.map((u) => u.compliance_type_id)).toEqual(['t1']); // only block_all blocks staff
  });
});

describe('bookingDatetime', () => {
  // Built as local wall-clock, so assert via local getters / relative deltas (tz-robust).
  it('combines date + time, tolerating HH:MM and HH:MM:SS', () => {
    const d = bookingDatetime('2026-06-10', '14:00');
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([
      2026, 5, 10, 14, 0,
    ]);
    const delta =
      bookingDatetime('2026-06-10', '14:30:00').getTime() - bookingDatetime('2026-06-10', '14:00').getTime();
    expect(delta).toBe(30 * 60 * 1000);
  });
  it('defaults missing time to midnight', () => {
    expect(bookingDatetime('2026-06-10', null).getTime()).toBe(
      bookingDatetime('2026-06-10', '00:00:00').getTime(),
    );
  });
});
