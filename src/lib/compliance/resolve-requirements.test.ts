import { describe, expect, it } from 'vitest';
import { computeExpiresAt } from '@/lib/compliance/form-schema';
import {
  bookingDatetime,

  isBlocking,
  mergeRequirementsServiceWins,
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
    result_type: 'pass_fail',
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

  // audit H4: pass/fail records only satisfy on an explicit 'pass'.
  it('rejects a pass_fail record whose result is fail / inconclusive / null', () => {
    expect(isRecordValidForBooking(rec({ result_type: 'pass_fail', result: 'fail' }), BOOKING, null)).toBe(false);
    expect(isRecordValidForBooking(rec({ result_type: 'pass_fail', result: 'inconclusive' }), BOOKING, null)).toBe(
      false,
    );
    expect(isRecordValidForBooking(rec({ result_type: 'pass_fail', result: null }), BOOKING, null)).toBe(false);
  });
  it('accepts a pass_fail record whose result is pass', () => {
    expect(isRecordValidForBooking(rec({ result_type: 'pass_fail', result: 'pass' }), BOOKING, null)).toBe(true);
  });
  it('ignores result for non-pass_fail types (signed / completed)', () => {
    expect(isRecordValidForBooking(rec({ result_type: 'signed', result: null }), BOOKING, null)).toBe(true);
    expect(isRecordValidForBooking(rec({ result_type: 'completed', result: 'completed' }), BOOKING, null)).toBe(
      true,
    );
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
    ['block_all', 'staff', false], // staff are never blocked (plan §5)
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

    expect(online.warnings.map((w) => [w.compliance_type_id, w.severity])).toEqual([['t2', 'advisory']]);

    const staff = summariseBlocking(resolved, 'staff');
    expect(staff.blocked).toBe(false); // staff are never blocked (plan §5)
    expect(staff.unmet).toEqual([]);
    // Every unmet requirement reaches staff as a warning, the block_all rule first as `required`.
    expect(staff.warnings.map((w) => [w.compliance_type_id, w.severity])).toEqual([
      ['t1', 'required'],
      ['t2', 'advisory'],
      ['t3', 'advisory'],
    ]);
  });
});

describe('mergeRequirementsServiceWins (venue-wide requirements, plan §4.2)', () => {
  it('adds venue-wide rows for types the service does not name itself', () => {
    const merged = mergeRequirementsServiceWins(
      [req({ id: 's1', compliance_type_id: 'patch-test', enforcement: 'block_all' })],
      [req({ id: 'v1', compliance_type_id: 'intake', enforcement: 'block_online', scope: 'venue' })],
    );
    expect(merged.map((r) => r.id)).toEqual(['s1', 'v1']);
  });

  it('lets the service row win when both name the same type', () => {
    const merged = mergeRequirementsServiceWins(
      [req({ id: 's1', compliance_type_id: 'intake', enforcement: 'block_all', lock_period_hours: 48 })],
      [req({ id: 'v1', compliance_type_id: 'intake', enforcement: 'warn_client', scope: 'venue' })],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ id: 's1', enforcement: 'block_all', lock_period_hours: 48 });
  });

  it('is the venue rows alone for a service with none of its own', () => {
    const merged = mergeRequirementsServiceWins([], [req({ id: 'v1', compliance_type_id: 'intake', scope: 'venue' })]);
    expect(merged.map((r) => r.id)).toEqual(['v1']);
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

describe('per-visit (validity 0) forms completed before the appointment day', () => {
  // The reported bug: a per-visit form completed at booking time (or from the confirmation
  // link) expired the same night, so on the day of the appointment the requirement resolved
  // to EXPIRED and a blocking requirement rejected the booking the form was completed for.
  // Per-visit expiry now runs to the end of the VISIT day, so an advance completion counts.
  const VISIT_DAY = '2026-06-10';
  const CAPTURED_AT = new Date('2026-06-07T14:00:00Z'); // three days early, at booking time
  // 09:00 keeps the assertion true whatever timezone the test machine runs in: bookingDatetime
  // builds a local wall-clock instant, and 09:00 local sits inside the visit day for every
  // real UTC offset. The venue-timezone skew in that helper is tracked separately.
  const APPOINTMENT = bookingDatetime(VISIT_DAY, '09:00:00');

  const perVisitReq = (overrides: Partial<ResolverRequirement> = {}) =>
    req({ validity_period_days: 0, ...overrides });
  const perVisit = (expiresAt: Date | null) =>
    rec({ captured_at: CAPTURED_AT, expires_at: expiresAt, result: 'signed', result_type: 'signed' });

  it('satisfies the appointment it was completed for, and reads as current', () => {
    const expiresAt = computeExpiresAt(0, CAPTURED_AT, 'Europe/London', VISIT_DAY);
    expect(isRecordValidForBooking(perVisit(expiresAt), APPOINTMENT, null)).toBe(true);

    const resolved = resolveRequirement(
      perVisitReq({ enforcement: 'block_online' }),
      [perVisit(expiresAt)],
      APPOINTMENT,
      CAPTURED_AT,
    );
    expect(resolved.state).toBe('satisfied');
    expect(resolved.matchingRecord?.id).toBe('rec1');
    expect(isBlocking(resolved.state, 'block_online', 'online')).toBe(false);
    expect(isBlocking(resolved.state, 'block_all', 'staff')).toBe(false);
  });

  it('did not, when expiry was anchored to the capture day', () => {
    // Regression guard: this is exactly the old behaviour, kept as the contrast case.
    const captureDayExpiry = computeExpiresAt(0, CAPTURED_AT, 'Europe/London');
    expect(isRecordValidForBooking(perVisit(captureDayExpiry), APPOINTMENT, null)).toBe(false);
    expect(resolveRequirement(perVisitReq(), [perVisit(captureDayExpiry)], APPOINTMENT, CAPTURED_AT).state).toBe(
      'expired',
    );
  });

  it('is still per visit: it does not carry over to a later appointment', () => {
    const expiresAt = computeExpiresAt(0, CAPTURED_AT, 'Europe/London', VISIT_DAY);
    const nextDay = bookingDatetime('2026-06-11', '09:00:00');
    expect(isRecordValidForBooking(perVisit(expiresAt), nextDay, null)).toBe(false);
    expect(resolveRequirement(perVisitReq(), [perVisit(expiresAt)], nextDay, CAPTURED_AT).state).toBe('expired');
  });

  it('still satisfies a same-day capture with no known appointment (walk-in)', () => {
    const sameDayCapture = new Date('2026-06-10T08:00:00Z');
    const expiresAt = computeExpiresAt(0, sameDayCapture, 'Europe/London');
    const later = bookingDatetime(VISIT_DAY, '15:00:00');
    expect(
      isRecordValidForBooking(
        rec({ captured_at: sameDayCapture, expires_at: expiresAt, result: 'signed', result_type: 'signed' }),
        later,
        null,
      ),
    ).toBe(true);
  });

  it('still respects the lock period when completed too close to the appointment', () => {
    // Completed 2h before a visit that requires 48h notice: valid for the day, but too late.
    const lateCapture = new Date(APPOINTMENT.getTime() - 2 * 60 * 60 * 1000);
    const expiresAt = computeExpiresAt(0, lateCapture, 'Europe/London', VISIT_DAY);
    const record = rec({
      captured_at: lateCapture,
      expires_at: expiresAt,
      result: 'signed',
      result_type: 'signed',
    });
    expect(isRecordValidForBooking(record, APPOINTMENT, null)).toBe(true);
    expect(isRecordValidForBooking(record, APPOINTMENT, 48)).toBe(false);
    expect(resolveRequirement(perVisitReq({ lock_period_hours: 48 }), [record], APPOINTMENT, lateCapture).lockBlocked).toBe(
      true,
    );
  });
});

describe('EXPIRING_SOON only where there is something to renew', () => {
  // Every per-visit record expires inside the 30-day window by design, so labelling one
  // "expiring soon" flags a record that is doing exactly what it should. Fixed-period and
  // lifetime types keep the warning, which is the case it exists for.
  const soon = new Date(NOW.getTime() + 3 * 24 * 60 * 60 * 1000);
  const perVisitRecord = rec({ expires_at: soon, result: 'signed', result_type: 'signed' });

  it('does not flag a per-visit record', () => {
    const resolved = resolveRequirement(
      req({ validity_period_days: 0 }),
      [perVisitRecord],
      new Date(NOW.getTime() + 60 * 60 * 1000),
      NOW,
    );
    expect(resolved.state).toBe('satisfied');
    expect(resolved.matchingRecord?.id).toBe('rec1');
  });

  it('still flags a fixed-period record nearing expiry', () => {
    const resolved = resolveRequirement(
      req({ validity_period_days: 90 }),
      [perVisitRecord],
      new Date(NOW.getTime() + 60 * 60 * 1000),
      NOW,
    );
    expect(resolved.state).toBe('expiring_soon');
  });

  it('keeps the old labelling when the loader did not supply the validity', () => {
    const resolved = resolveRequirement(req(), [perVisitRecord], new Date(NOW.getTime() + 60 * 60 * 1000), NOW);
    expect(resolved.state).toBe('expiring_soon');
  });
});
