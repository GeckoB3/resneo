import { describe, expect, it } from 'vitest';
import { FakeSupabase } from '@/lib/compliance/test-utils/fake-supabase';
import { loadBookingComplianceFlags } from '@/lib/compliance/booking-flags';

const VENUE = 'venue-1';
const GUEST = 'guest-1';
const NOW = new Date('2026-06-15T00:00:00Z');

function booking(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'b1',
    venue_id: VENUE,
    guest_id: GUEST,
    booking_date: '2026-07-01',
    booking_time: '10:00:00',
    status: 'Booked',
    appointment_service_id: 'svc-1',
    service_item_id: null,
    ...over,
  };
}

function req(enforcement: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `r-${enforcement}`,
    venue_id: VENUE,
    appointment_service_id: 'svc-1',
    service_item_id: null,
    compliance_type_id: 't1',
    enforcement,
    lock_period_hours: null,
    ...over,
  };
}

function validRecord(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'rec1',
    venue_id: VENUE,
    guest_id: GUEST,
    compliance_type_id: 't1',
    status: 'completed',
    expires_at: null, // lifetime
    voided_at: null,
    captured_at: '2026-06-01T00:00:00Z',
    result: 'pass',
    captured_by_staff_id: 'staff-1',
    ...over,
  };
}

function fake(opts: { bookings?: Record<string, unknown>[]; requirements?: Record<string, unknown>[]; records?: Record<string, unknown>[] }) {
  return new FakeSupabase({
    bookings: opts.bookings ?? [booking()],
    service_compliance_requirements: opts.requirements ?? [],
    compliance_records: opts.records ?? [],
  });
}

describe('loadBookingComplianceFlags', () => {
  it('flags a missing blocking requirement as unmet + blocking', async () => {
    const f = fake({ requirements: [req('block_all')] });
    const flags = await loadBookingComplianceFlags(f.asClient(), VENUE, ['b1'], NOW);
    expect(flags.b1).toBeDefined();
    expect(flags.b1!.state).toBe('unmet');
    expect(flags.b1!.blocking).toBe(true);
    expect(flags.b1!.labels.length).toBeGreaterThan(0);
  });

  it('marks a warn_client unmet requirement as non-blocking', async () => {
    const f = fake({ requirements: [req('warn_client')] });
    const flags = await loadBookingComplianceFlags(f.asClient(), VENUE, ['b1'], NOW);
    expect(flags.b1!.state).toBe('unmet');
    expect(flags.b1!.blocking).toBe(false);
  });

  it('reports satisfied when a valid record is on file', async () => {
    const f = fake({ requirements: [req('block_all')], records: [validRecord()] });
    const flags = await loadBookingComplianceFlags(f.asClient(), VENUE, ['b1'], NOW);
    expect(flags.b1!.state).toBe('satisfied');
    expect(flags.b1!.blocking).toBe(false);
  });

  it('omits bookings whose service has no requirement', async () => {
    const f = fake({ bookings: [booking({ appointment_service_id: 'svc-other' })], requirements: [req('block_all')] });
    const flags = await loadBookingComplianceFlags(f.asClient(), VENUE, ['b1'], NOW);
    expect(flags.b1).toBeUndefined();
  });

  it('skips cancelled / no-show bookings', async () => {
    const f = fake({ bookings: [booking({ status: 'Cancelled' })], requirements: [req('block_all')] });
    const flags = await loadBookingComplianceFlags(f.asClient(), VENUE, ['b1'], NOW);
    expect(flags.b1).toBeUndefined();
  });

  it('returns {} for an empty id list', async () => {
    const f = fake({ requirements: [req('block_all')] });
    expect(await loadBookingComplianceFlags(f.asClient(), VENUE, [], NOW)).toEqual({});
  });

  it('treats an expired record as unmet', async () => {
    const f = fake({
      requirements: [req('block_online')],
      records: [validRecord({ expires_at: '2026-06-10T00:00:00Z' })], // expired before NOW
    });
    const flags = await loadBookingComplianceFlags(f.asClient(), VENUE, ['b1'], NOW);
    expect(flags.b1!.state).toBe('unmet');
    expect(flags.b1!.blocking).toBe(true);
  });
});
