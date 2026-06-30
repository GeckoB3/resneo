import { describe, expect, it } from 'vitest';
import { FakeSupabase } from '@/lib/compliance/test-utils/fake-supabase';
import {
  checkBookingCompliance,
  complianceUnmetMessage,
  enforceBookingCompliance,
  COMPLIANCE_REQUIREMENT_UNMET,
} from '@/lib/compliance/enforce-booking';

const VENUE = 'venue-1';
const GUEST = 'guest-1';

function fakeWith(opts: {
  tier?: string;
  flagOn?: boolean;
  requirements?: Array<Record<string, unknown>>;
  records?: Array<Record<string, unknown>>;
}) {
  return new FakeSupabase({
    venues: [
      {
        id: VENUE,
        pricing_tier: opts.tier ?? 'appointments',
        feature_flags: opts.flagOn === false ? {} : { compliance_records_enabled: true },
      },
    ],
    service_compliance_requirements: opts.requirements ?? [],
    compliance_records: opts.records ?? [],
  });
}

const base = {
  venueId: VENUE,
  guestId: GUEST,
  appointmentServiceId: null,
  serviceItemId: 'svc-1' as string | null,
  bookingDate: '2026-07-01',
  bookingTime: '10:00',
};

describe('checkBookingCompliance short-circuits (allow)', () => {
  it('allows non-Model-B bookings (no service FK)', async () => {
    const fake = fakeWith({});
    const res = await checkBookingCompliance(fake.asClient(), {
      ...base,
      appointmentServiceId: null,
      serviceItemId: null,
      context: 'online',
    });
    expect(res.blocked).toBe(false);
  });

  it('allows when the venue is not on an Appointments tier', async () => {
    const fake = fakeWith({ tier: 'restaurant', requirements: [reqRow('block_all')] });
    const res = await checkBookingCompliance(fake.asClient(), { ...base, context: 'online' });
    expect(res.blocked).toBe(false);
  });

  it('allows when the feature flag is off', async () => {
    const fake = fakeWith({ flagOn: false, requirements: [reqRow('block_all')] });
    const res = await checkBookingCompliance(fake.asClient(), { ...base, context: 'online' });
    expect(res.blocked).toBe(false);
  });

  it('allows when the service has no requirements', async () => {
    const fake = fakeWith({ requirements: [] });
    const res = await checkBookingCompliance(fake.asClient(), { ...base, context: 'online' });
    expect(res.blocked).toBe(false);
  });
});

function reqRow(enforcement: string, typeId = 't1'): Record<string, unknown> {
  return {
    id: `req-${typeId}-${enforcement}`,
    venue_id: VENUE,
    service_item_id: 'svc-1',
    compliance_type_id: typeId,
    enforcement,
    lock_period_hours: null,
  };
}

describe('checkBookingCompliance enforcement', () => {
  it('blocks a missing block_all requirement in any context', async () => {
    const online = await checkBookingCompliance(fakeWith({ requirements: [reqRow('block_all')] }).asClient(), {
      ...base,
      context: 'online',
    });
    expect(online.blocked).toBe(true);
    expect(online.details[0]!.enforcement).toBe('block_all');

    const staff = await checkBookingCompliance(fakeWith({ requirements: [reqRow('block_all')] }).asClient(), {
      ...base,
      context: 'staff',
    });
    expect(staff.blocked).toBe(true);
  });

  it('blocks block_online only in the online context', async () => {
    const online = await checkBookingCompliance(fakeWith({ requirements: [reqRow('block_online')] }).asClient(), {
      ...base,
      context: 'online',
    });
    expect(online.blocked).toBe(true);

    const staff = await checkBookingCompliance(fakeWith({ requirements: [reqRow('block_online')] }).asClient(), {
      ...base,
      context: 'staff',
    });
    expect(staff.blocked).toBe(false);
  });

  it('never blocks warn_staff / warn_client, but surfaces them as warnings (audit M2)', async () => {
    const res = await checkBookingCompliance(
      fakeWith({ requirements: [reqRow('warn_staff'), reqRow('warn_client', 't2')] }).asClient(),
      { ...base, context: 'online' },
    );
    expect(res.blocked).toBe(false);
    expect(res.warnings.map((w) => w.enforcement).sort()).toEqual(['warn_client', 'warn_staff']);
  });

  it('allows when a valid record satisfies the requirement', async () => {
    const fake = fakeWith({
      requirements: [reqRow('block_all')],
      records: [
        {
          id: 'rec-1',
          venue_id: VENUE,
          guest_id: GUEST,
          compliance_type_id: 't1',
          status: 'completed',
          expires_at: null, // lifetime
          voided_at: null,
          captured_at: '2026-06-01T00:00:00Z',
          result: 'pass',
          captured_by_staff_id: 'staff-1',
        },
      ],
    });
    const res = await checkBookingCompliance(fake.asClient(), { ...base, context: 'online' });
    expect(res.blocked).toBe(false);
  });
});

describe('complianceUnmetMessage', () => {
  const detail = (name: string) => ({
    compliance_type_id: name,
    compliance_type_name: name,
    enforcement: 'block_online',
    state: 'missing',
  });

  it('names a single requirement (online context)', () => {
    const msg = complianceUnmetMessage([detail('PPD Patch Test')], 'online');
    expect(msg).toContain('PPD Patch Test');
    expect(msg).toContain('booking online');
    expect(msg).not.toContain('COMPLIANCE');
  });

  it('joins multiple requirements with "and"', () => {
    const msg = complianceUnmetMessage([detail('Patch Test'), detail('Consent Form')], 'online');
    expect(msg).toContain('Patch Test');
    expect(msg).toContain('and Consent Form');
  });

  it('de-duplicates repeated type names', () => {
    const msg = complianceUnmetMessage([detail('Patch Test'), detail('Patch Test')], 'staff');
    expect(msg.match(/Patch Test/g)?.length).toBe(1);
  });

  it('falls back when details are empty', () => {
    expect(complianceUnmetMessage([], 'online')).toMatch(/compliance record/i);
  });
});

describe('enforceBookingCompliance (centralised gate)', () => {
  it('allows and returns no body when nothing blocks', async () => {
    const res = await enforceBookingCompliance(fakeWith({ requirements: [reqRow('warn_client')] }).asClient(), {
      ...base,
      context: 'online',
    });
    expect(res.blocked).toBe(false);
    expect(res.body).toBeUndefined();
  });

  it('blocks online and prepares the canonical 409 body', async () => {
    const res = await enforceBookingCompliance(fakeWith({ requirements: [reqRow('block_online')] }).asClient(), {
      ...base,
      context: 'online',
    });
    expect(res.blocked).toBe(true);
    expect(res.body?.error).toBe(COMPLIANCE_REQUIREMENT_UNMET);
    expect(res.body?.message).toMatch(/booking online/i);
    expect(res.body?.details[0]!.enforcement).toBe('block_online');
  });

  it('lets an admin override a staff-context block', async () => {
    const res = await enforceBookingCompliance(fakeWith({ requirements: [reqRow('block_all')] }).asClient(), {
      ...base,
      context: 'staff',
      adminOverride: true,
    });
    expect(res.blocked).toBe(false);
    expect(res.body).toBeUndefined();
  });

  it('still blocks staff context when no override is given', async () => {
    const res = await enforceBookingCompliance(fakeWith({ requirements: [reqRow('block_all')] }).asClient(), {
      ...base,
      context: 'staff',
    });
    expect(res.blocked).toBe(true);
  });

  it('ignores override in the online context (a guest can never override)', async () => {
    const res = await enforceBookingCompliance(fakeWith({ requirements: [reqRow('block_online')] }).asClient(), {
      ...base,
      context: 'online',
      adminOverride: true,
    });
    expect(res.blocked).toBe(true);
  });
});
