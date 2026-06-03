import { describe, expect, it } from 'vitest';
import { FakeSupabase } from '@/lib/compliance/test-utils/fake-supabase';
import {
  createComplianceType,
  createComplianceTypeVersion,
  listComplianceTypesWithCounts,
} from '@/lib/compliance/types-service';
import { ppdPatchTestTemplate } from '@/lib/compliance/library/templates/ppd-patch-test';

const VENUE = 'venue-1';
const STAFF = 'staff-1';

function baseCreateParams() {
  return {
    venueId: VENUE,
    staffId: STAFF,
    name: 'PPD Patch Test',
    category: 'test' as const,
    resultType: 'pass_fail' as const,
    validityPeriodDays: 180,
    captureMethods: ['staff_in_venue' as const],
    formSchema: ppdPatchTestTemplate.form_schema,
  };
}

describe('createComplianceType', () => {
  it('creates a type + first version and links current_version_id', async () => {
    const fake = new FakeSupabase();
    const res = await createComplianceType(fake.asClient(), baseCreateParams());
    expect(res.ok).toBe(true);

    const types = fake.tables.compliance_types ?? [];
    const versions = fake.tables.compliance_type_versions ?? [];
    expect(types).toHaveLength(1);
    expect(versions).toHaveLength(1);
    expect(versions[0]!.version_number).toBe(1);
    expect(types[0]!.current_version_id).toBe(versions[0]!.id);
    expect(types[0]!.slug).toBe('ppd-patch-test');

    // type.created + version.created audit events written.
    const audit = fake.tables.compliance_audit_events ?? [];
    expect(audit.map((a) => a.event_type).sort()).toEqual(['type.created', 'version.created']);
  });

  it('rejects an invalid schema for the result type (400) and writes nothing', async () => {
    const fake = new FakeSupabase();
    const res = await createComplianceType(fake.asClient(), {
      ...baseCreateParams(),
      // completed result type but schema has a pass_fail result_mapping → still fine;
      // instead break it: a pass_fail type whose schema has no result field.
      formSchema: { schema_version: '1.0', title: 'X', fields: [{ id: 'a', type: 'text', label: 'A' }] },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(400);
    expect(fake.tables.compliance_types ?? []).toHaveLength(0);
  });

  it('rolls back the orphan type when version insert fails', async () => {
    const fake = new FakeSupabase({}, { failNextInsert: { compliance_type_versions: { message: 'boom' } } });
    const res = await createComplianceType(fake.asClient(), baseCreateParams());
    expect(res.ok).toBe(false);
    expect(fake.tables.compliance_types ?? []).toHaveLength(0); // rolled back
  });

  it('de-duplicates slugs within a venue', async () => {
    const fake = new FakeSupabase({
      compliance_types: [{ id: 'existing', venue_id: VENUE, slug: 'ppd-patch-test' }],
    });
    const res = await createComplianceType(fake.asClient(), baseCreateParams());
    expect(res.ok).toBe(true);
    const created = (fake.tables.compliance_types ?? []).find((t) => t.id !== 'existing');
    expect(created?.slug).toBe('ppd-patch-test-2');
  });
});

describe('createComplianceTypeVersion', () => {
  it('increments the version number and updates current_version_id', async () => {
    const fake = new FakeSupabase({
      compliance_types: [{ id: 'type-1', venue_id: VENUE, result_type: 'completed' }],
      compliance_type_versions: [
        { id: 'v1', compliance_type_id: 'type-1', venue_id: VENUE, version_number: 1 },
        { id: 'v2', compliance_type_id: 'type-1', venue_id: VENUE, version_number: 2 },
      ],
    });
    const res = await createComplianceTypeVersion(fake.asClient(), {
      venueId: VENUE,
      staffId: STAFF,
      typeId: 'type-1',
      formSchema: { schema_version: '1.0', title: 'T', fields: [{ id: 'a', type: 'text', label: 'A' }] },
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.versionNumber).toBe(3);
    const type = (fake.tables.compliance_types ?? [])[0]!;
    expect(type.current_version_id).toBe(res.ok ? res.value.versionId : null);
  });

  it('404s for a type in another venue', async () => {
    const fake = new FakeSupabase({
      compliance_types: [{ id: 'type-1', venue_id: 'other-venue', result_type: 'completed' }],
    });
    const res = await createComplianceTypeVersion(fake.asClient(), {
      venueId: VENUE,
      staffId: STAFF,
      typeId: 'type-1',
      formSchema: { schema_version: '1.0', title: 'T', fields: [{ id: 'a', type: 'text', label: 'A' }] },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(404);
  });
});

describe('listComplianceTypesWithCounts', () => {
  it('aggregates current version number, requirement and record counts', async () => {
    const fake = new FakeSupabase({
      compliance_types: [{ id: 't1', venue_id: VENUE, is_active: true, created_at: '2026-01-01' }],
      compliance_type_versions: [
        { id: 'v1', compliance_type_id: 't1', version_number: 1 },
        { id: 'v2', compliance_type_id: 't1', version_number: 2 },
      ],
      service_compliance_requirements: [
        { id: 'r1', compliance_type_id: 't1', venue_id: VENUE },
        { id: 'r2', compliance_type_id: 't1', venue_id: VENUE },
      ],
      compliance_records: [{ id: 'rec1', compliance_type_id: 't1', venue_id: VENUE }],
    });
    const list = await listComplianceTypesWithCounts(fake.asClient(), VENUE);
    expect(list).toHaveLength(1);
    expect(list[0]!.current_version_number).toBe(2);
    expect(list[0]!.service_requirement_count).toBe(2);
    expect(list[0]!.record_count).toBe(1);
  });

  it('excludes archived types unless requested', async () => {
    const fake = new FakeSupabase({
      compliance_types: [
        { id: 't1', venue_id: VENUE, is_active: true, created_at: '2026-01-01' },
        { id: 't2', venue_id: VENUE, is_active: false, created_at: '2026-01-02' },
      ],
    });
    expect(await listComplianceTypesWithCounts(fake.asClient(), VENUE)).toHaveLength(1);
    expect(await listComplianceTypesWithCounts(fake.asClient(), VENUE, { includeArchived: true })).toHaveLength(2);
  });
});
