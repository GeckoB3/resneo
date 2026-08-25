import { describe, expect, it } from 'vitest';
import { FakeSupabase } from '@/lib/compliance/test-utils/fake-supabase';
import {
  captureComplianceRecord,
  rescheduleBookingComplianceRecords,
  type CaptureContext,
} from '@/lib/compliance/records-service';
import { endOfLocalDayForYmd } from '@/lib/venue/venue-local-clock';
import type { ComplianceFormSchema } from '@/lib/compliance/form-schema';

/**
 * Expiry written at capture time, with the focus on per-visit types (validity 0).
 *
 * Those used to expire at the end of the day they were FILLED IN, so a guest who
 * completed the form at booking time, or from the confirmation link, found it already
 * expired on the day of the appointment. Expiry now runs to the end of the appointment
 * day: taken from the caller's `visitDate` when the booking row does not exist yet,
 * otherwise read from the booking the record is attached to.
 */

const VENUE = 'venue-1';
const GUEST = 'guest-1';
const TZ = 'Europe/London';
const VISIT_DAY = '2027-06-10';
const OTHER_DAY = '2027-06-17';

const SCHEMA: ComplianceFormSchema = {
  schema_version: '1.0',
  title: 'Treatment Consent',
  fields: [{ id: 'f_note', type: 'text', label: 'Anything we should know?', required: false, staff_only: false }],
};

function seed(extra: Record<string, unknown[]> = {}) {
  return new FakeSupabase({
    venues: [{ id: VENUE, name: 'Glow Studio', timezone: TZ }],
    bookings: [
      { id: 'b1', venue_id: VENUE, booking_date: VISIT_DAY, booking_time: '09:00:00' },
      { id: 'b-other-venue', venue_id: 'venue-2', booking_date: OTHER_DAY, booking_time: '09:00:00' },
    ],
    compliance_records: [],
    ...extra,
  });
}

function ctx(overrides: Partial<CaptureContext> = {}): CaptureContext {
  return {
    venueId: VENUE,
    guestId: GUEST,
    complianceTypeId: 't1',
    complianceTypeVersionId: 'v1',
    resultType: 'signed',
    validityPeriodDays: 0,
    formSchema: SCHEMA,
    bookingId: null,
    visitDate: null,
    captureChannel: 'client_email',
    capturedByStaffId: null,
    mode: 'public',
    actorType: 'client',
    ...overrides,
  };
}

async function capture(fake: FakeSupabase, overrides: Partial<CaptureContext> = {}) {
  const res = await captureComplianceRecord(fake.asClient(), ctx(overrides), {});
  expect(res.ok).toBe(true);
  const row = (fake.tables.compliance_records ?? [])[0] as { expires_at: string | null };
  return row;
}

describe('captureComplianceRecord — per-visit expiry', () => {
  it('uses the explicit visit date when the booking row does not exist yet (inline capture)', async () => {
    const fake = seed();
    const row = await capture(fake, { visitDate: VISIT_DAY, captureChannel: 'client_booking' });
    expect(row.expires_at).toBe(endOfLocalDayForYmd(VISIT_DAY, TZ).toISOString());
  });

  it('reads the date off the booking the record is attached to (confirmation link)', async () => {
    const fake = seed();
    const row = await capture(fake, { bookingId: 'b1' });
    expect(row.expires_at).toBe(endOfLocalDayForYmd(VISIT_DAY, TZ).toISOString());
  });

  it('prefers an explicit visit date over the booking it is attached to', async () => {
    const fake = seed();
    const row = await capture(fake, { bookingId: 'b1', visitDate: OTHER_DAY });
    expect(row.expires_at).toBe(endOfLocalDayForYmd(OTHER_DAY, TZ).toISOString());
  });

  it('falls back to the capture day when no appointment is known (walk-in capture)', async () => {
    const fake = seed();
    const before = new Date();
    const row = await capture(fake, { captureChannel: 'client_walkin' });
    expect(row.expires_at).toBe(endOfLocalDayForYmd(ymdIn(before, TZ), TZ).toISOString());
  });

  it('does not read a booking belonging to another venue', async () => {
    const fake = seed();
    const before = new Date();
    const row = await capture(fake, { bookingId: 'b-other-venue' });
    // Scoped by venue_id, so the cross-venue booking is invisible and the capture day wins.
    expect(row.expires_at).toBe(endOfLocalDayForYmd(ymdIn(before, TZ), TZ).toISOString());
  });

  it('leaves lifetime and fixed-period types alone', async () => {
    const lifetime = await capture(seed(), { validityPeriodDays: null, bookingId: 'b1' });
    expect(lifetime.expires_at).toBeNull();

    const fake = seed();
    const before = Date.now();
    const ninetyDays = await capture(fake, { validityPeriodDays: 90, bookingId: 'b1' });
    const expiry = new Date(ninetyDays.expires_at as string).getTime();
    // captured_at + 90 days, unaffected by the booking date.
    expect(expiry).toBeGreaterThanOrEqual(before + 90 * 86_400_000);
    expect(expiry).toBeLessThan(before + 90 * 86_400_000 + 60_000);
  });
});

/** The YYYY-MM-DD an instant falls on in `timeZone`. */
function ymdIn(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * A per-visit record belongs to the appointment it was completed for, so a reschedule has
 * to carry it forward. Without this, moving a booking silently invalidates the consent
 * signed for it and a block_all requirement then rejects the reschedule itself.
 */
describe('rescheduleBookingComplianceRecords', () => {
  const CAPTURED_AT = '2027-06-07T09:00:00.000Z';
  const NEW_DAY = '2027-06-24';

  function record(overrides: Record<string, unknown> = {}) {
    return {
      id: 'rec-per-visit',
      venue_id: VENUE,
      guest_id: GUEST,
      compliance_type_id: 't1',
      booking_id: 'b1',
      status: 'completed',
      captured_at: CAPTURED_AT,
      expires_at: endOfLocalDayForYmd(VISIT_DAY, TZ).toISOString(),
      voided_at: null,
      compliance_types: { validity_period_days: 0 },
      ...overrides,
    };
  }

  function seedRecords(rows: Array<Record<string, unknown>>) {
    return new FakeSupabase({
      venues: [{ id: VENUE, name: 'Glow Studio', timezone: TZ }],
      compliance_records: rows,
      compliance_audit_events: [],
    });
  }

  const stored = (fake: FakeSupabase, id: string) =>
    (fake.tables.compliance_records ?? []).find((r) => r.id === id) as {
      expires_at: string;
      status: string;
    };

  it('moves the record to the end of the new appointment day', async () => {
    const fake = seedRecords([record()]);
    const moved = await rescheduleBookingComplianceRecords(fake.asClient(), {
      venueId: VENUE,
      bookingId: 'b1',
      newBookingDate: NEW_DAY,
    });
    expect(moved).toBe(1);
    expect(stored(fake, 'rec-per-visit').expires_at).toBe(endOfLocalDayForYmd(NEW_DAY, TZ).toISOString());
  });

  it('revives a record the nightly job already retired', async () => {
    const fake = seedRecords([record({ status: 'expired' })]);
    await rescheduleBookingComplianceRecords(fake.asClient(), {
      venueId: VENUE,
      bookingId: 'b1',
      newBookingDate: NEW_DAY,
    });
    const row = stored(fake, 'rec-per-visit');
    expect(row.status).toBe('completed');
    expect(new Date(row.expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('leaves a record retired when the new date is already in the past', async () => {
    // Captured and rescheduled entirely in the past, so the recomputed expiry is behind
    // `now` and there is nothing to revive.
    const fake = seedRecords([
      record({ status: 'expired', captured_at: '2024-01-02T09:00:00.000Z' }),
    ]);
    await rescheduleBookingComplianceRecords(fake.asClient(), {
      venueId: VENUE,
      bookingId: 'b1',
      newBookingDate: '2024-01-05',
    });
    const row = stored(fake, 'rec-per-visit');
    expect(row.status).toBe('expired');
    expect(row.expires_at).toBe(endOfLocalDayForYmd('2024-01-05', TZ).toISOString());
  });

  it('shortens expiry when the booking moves earlier, but never before the capture day', async () => {
    const fake = seedRecords([record()]);
    await rescheduleBookingComplianceRecords(fake.asClient(), {
      venueId: VENUE,
      bookingId: 'b1',
      newBookingDate: '2027-06-08',
    });
    expect(stored(fake, 'rec-per-visit').expires_at).toBe(
      endOfLocalDayForYmd('2027-06-08', TZ).toISOString(),
    );

    const late = seedRecords([record()]);
    await rescheduleBookingComplianceRecords(late.asClient(), {
      venueId: VENUE,
      bookingId: 'b1',
      // Before the day the form was signed: expiry clamps to the capture day, not earlier.
      newBookingDate: '2027-06-01',
    });
    expect(stored(late, 'rec-per-visit').expires_at).toBe(
      endOfLocalDayForYmd('2027-06-07', TZ).toISOString(),
    );
  });

  it('touches only per-visit records, and only on this booking', async () => {
    const untouched = [
      record({ id: 'fixed-period', compliance_types: { validity_period_days: 90 } }),
      record({ id: 'lifetime', expires_at: null, compliance_types: { validity_period_days: null } }),
      record({ id: 'other-booking', booking_id: 'b2' }),
      record({ id: 'voided', voided_at: '2027-06-08T00:00:00.000Z' }),
    ];
    const fake = seedRecords([record(), ...untouched]);
    const before = (fake.tables.compliance_records ?? []).map((r) => ({ ...r }));

    const moved = await rescheduleBookingComplianceRecords(fake.asClient(), {
      venueId: VENUE,
      bookingId: 'b1',
      newBookingDate: NEW_DAY,
    });

    expect(moved).toBe(1);
    for (const id of ['fixed-period', 'lifetime', 'other-booking', 'voided']) {
      const now = (fake.tables.compliance_records ?? []).find((r) => r.id === id);
      expect(now!.expires_at).toEqual(before.find((r) => r.id === id)!.expires_at);
    }
  });

  it('writes an audit event naming the reschedule', async () => {
    const fake = seedRecords([record()]);
    await rescheduleBookingComplianceRecords(fake.asClient(), {
      venueId: VENUE,
      bookingId: 'b1',
      newBookingDate: NEW_DAY,
    });
    const events = (fake.tables.compliance_audit_events ?? []) as Array<Record<string, unknown>>;
    expect(events).toHaveLength(1);
    expect(events[0]!.event_type).toBe('record.updated');
    expect(events[0]!.actor_type).toBe('system');
    expect(events[0]!.metadata).toMatchObject({
      reason: 'booking_rescheduled',
      booking_id: 'b1',
      new_booking_date: NEW_DAY,
    });
  });

  it('does nothing, and writes nothing, when the booking has no per-visit records', async () => {
    const fake = seedRecords([record({ compliance_types: { validity_period_days: 90 } })]);
    const moved = await rescheduleBookingComplianceRecords(fake.asClient(), {
      venueId: VENUE,
      bookingId: 'b1',
      newBookingDate: NEW_DAY,
    });
    expect(moved).toBe(0);
    expect(fake.tables.compliance_audit_events ?? []).toHaveLength(0);
  });

  it('is a no-op when the record is already on the right day', async () => {
    const fake = seedRecords([record({ expires_at: endOfLocalDayForYmd(NEW_DAY, TZ).toISOString() })]);
    const moved = await rescheduleBookingComplianceRecords(fake.asClient(), {
      venueId: VENUE,
      bookingId: 'b1',
      newBookingDate: NEW_DAY,
    });
    expect(moved).toBe(0);
    expect(fake.tables.compliance_audit_events ?? []).toHaveLength(0);
  });
});
