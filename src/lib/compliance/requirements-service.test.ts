import { describe, expect, it } from 'vitest';
import { FakeSupabase } from '@/lib/compliance/test-utils/fake-supabase';
import {
  addRequirement,
  resolveServiceFkColumn,
  removeRequirement,
} from '@/lib/compliance/requirements-service';

const VENUE = 'venue-1';
const STAFF = 'staff-1';

describe('resolveServiceFkColumn', () => {
  it('uses service_item_id for unified scheduling venues', async () => {
    const fake = new FakeSupabase({ venues: [{ id: VENUE, booking_model: 'unified_scheduling', enabled_models: null }] });
    expect(await resolveServiceFkColumn(fake.asClient(), VENUE)).toBe('service_item_id');
  });
  it('uses appointment_service_id for legacy practitioner venues', async () => {
    const fake = new FakeSupabase({ venues: [{ id: VENUE, booking_model: 'practitioner_appointment', enabled_models: null }] });
    expect(await resolveServiceFkColumn(fake.asClient(), VENUE)).toBe('appointment_service_id');
  });
});

describe('addRequirement', () => {
  function unifiedFake(extra: Record<string, unknown[]> = {}) {
    return new FakeSupabase({
      venues: [{ id: VENUE, booking_model: 'unified_scheduling', enabled_models: null }],
      service_items: [{ id: 'svc-1', venue_id: VENUE }],
      compliance_types: [{ id: 'type-1', venue_id: VENUE, is_active: true }],
      ...extra,
    });
  }

  it('writes the service_item_id column for a unified venue', async () => {
    const fake = unifiedFake();
    const res = await addRequirement(fake.asClient(), {
      venueId: VENUE,
      staffId: STAFF,
      serviceId: 'svc-1',
      complianceTypeId: 'type-1',
      enforcement: 'block_all',
      lockPeriodHours: 48,
    });
    expect(res.ok).toBe(true);
    const row = (fake.tables.service_compliance_requirements ?? [])[0]!;
    expect(row.service_item_id).toBe('svc-1');
    expect(row.appointment_service_id).toBeUndefined();
    expect(row.enforcement).toBe('block_all');
    expect(row.lock_period_hours).toBe(48);
    expect((fake.tables.compliance_audit_events ?? []).some((a) => a.event_type === 'requirement.added')).toBe(true);
  });

  it('404s when the service is not in the venue', async () => {
    const fake = unifiedFake({ service_items: [] });
    const res = await addRequirement(fake.asClient(), {
      venueId: VENUE, staffId: STAFF, serviceId: 'svc-x', complianceTypeId: 'type-1',
      enforcement: 'warn_staff', lockPeriodHours: null,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(404);
  });

  it('400s when the type is archived', async () => {
    const fake = unifiedFake({ compliance_types: [{ id: 'type-1', venue_id: VENUE, is_active: false }] });
    const res = await addRequirement(fake.asClient(), {
      venueId: VENUE, staffId: STAFF, serviceId: 'svc-1', complianceTypeId: 'type-1',
      enforcement: 'warn_staff', lockPeriodHours: null,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(400);
  });

  it('409s on a duplicate (service, type) requirement', async () => {
    const fake = unifiedFake();
    fake.tables.service_compliance_requirements = [];
    // Force the unique violation on insert.
    const fakeWithDup = new FakeSupabase(
      {
        venues: [{ id: VENUE, booking_model: 'unified_scheduling', enabled_models: null }],
        service_items: [{ id: 'svc-1', venue_id: VENUE }],
        compliance_types: [{ id: 'type-1', venue_id: VENUE, is_active: true }],
      },
      { failNextInsert: { service_compliance_requirements: { code: '23505', message: 'dup' } } },
    );
    const res = await addRequirement(fakeWithDup.asClient(), {
      venueId: VENUE, staffId: STAFF, serviceId: 'svc-1', complianceTypeId: 'type-1',
      enforcement: 'warn_staff', lockPeriodHours: null,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(409);
  });
});

describe('removeRequirement', () => {
  it('removes an existing requirement and audits it', async () => {
    const fake = new FakeSupabase({
      service_compliance_requirements: [{ id: 'req-1', venue_id: VENUE, compliance_type_id: 'type-1' }],
    });
    const res = await removeRequirement(fake.asClient(), { venueId: VENUE, staffId: STAFF, requirementId: 'req-1' });
    expect(res.ok).toBe(true);
    expect(fake.tables.service_compliance_requirements ?? []).toHaveLength(0);
    expect((fake.tables.compliance_audit_events ?? []).some((a) => a.event_type === 'requirement.removed')).toBe(true);
  });

  it('404s for an unknown requirement', async () => {
    const fake = new FakeSupabase({ service_compliance_requirements: [] });
    const res = await removeRequirement(fake.asClient(), { venueId: VENUE, staffId: STAFF, requirementId: 'nope' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(404);
  });
});
