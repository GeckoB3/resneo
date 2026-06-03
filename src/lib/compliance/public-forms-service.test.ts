import { describe, expect, it } from 'vitest';
import { FakeSupabase } from '@/lib/compliance/test-utils/fake-supabase';
import {
  loadPublicFormByCode,
  publicServiceRequirements,
  stripStaffOnlyFields,
  submitPublicForm,
} from '@/lib/compliance/public-forms-service';
import type { ComplianceFormSchema } from '@/lib/compliance/form-schema';

const VENUE = 'venue-1';
const GUEST = 'guest-1';
const CODE = 'abcdefghij';
const future = () => new Date(Date.now() + 7 * 86_400_000).toISOString();
const past = () => new Date(Date.now() - 86_400_000).toISOString();

const SCHEMA: ComplianceFormSchema = {
  schema_version: '1.0',
  title: 'Consent',
  fields: [
    { id: 'f_name', type: 'text', label: 'Your name', required: true, staff_only: false },
    {
      id: 'f_result',
      type: 'select',
      label: 'Result',
      required: true,
      staff_only: true,
      options: [{ value: 'pass', label: 'Pass' }],
    },
  ],
};

function seed(linkOverrides: Record<string, unknown> = {}, extra: Record<string, unknown[]> = {}) {
  return new FakeSupabase({
    compliance_form_links: [
      {
        id: 'l1',
        venue_id: VENUE,
        code: CODE,
        guest_id: GUEST,
        compliance_type_id: 't1',
        compliance_type_version_id: 'v1',
        booking_id: null,
        status: 'pending',
        sent_via: 'email',
        expires_at: future(),
        prefill: { email: 'jane@x.com' },
        access_count: 0,
        ...linkOverrides,
      },
    ],
    compliance_type_versions: [{ id: 'v1', form_schema: SCHEMA }],
    compliance_types: [{ id: 't1', venue_id: VENUE, name: 'Consent', result_type: 'completed', validity_period_days: null }],
    venues: [{ id: VENUE, name: 'Glow Studio', booking_model: 'unified_scheduling', enabled_models: null }],
    guests: [{ id: GUEST, venue_id: VENUE, email: 'jane@x.com' }],
    ...extra,
  });
}

describe('stripStaffOnlyFields', () => {
  it('removes staff_only fields', () => {
    expect(stripStaffOnlyFields(SCHEMA).fields.map((f) => f.id)).toEqual(['f_name']);
  });
});

describe('loadPublicFormByCode', () => {
  it('returns the public schema (staff_only stripped) + prefill for a valid link', async () => {
    const fake = seed();
    const res = await loadPublicFormByCode(fake.asClient(), CODE);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.schema.fields.map((f) => f.id)).toEqual(['f_name']);
      expect(res.value.type_name).toBe('Consent');
      expect(res.value.venue_name).toBe('Glow Studio');
      expect(res.value.prefill.email).toBe('jane@x.com');
    }
    // access_count incremented.
    expect((fake.tables.compliance_form_links ?? [])[0]!.access_count).toBe(1);
  });

  it('reports consumed / revoked / not_found', async () => {
    expect((await loadPublicFormByCode(seed({ status: 'consumed' }).asClient(), CODE)) as { reason?: string }).toMatchObject({ ok: false, reason: 'consumed' });
    expect((await loadPublicFormByCode(seed({ status: 'revoked' }).asClient(), CODE)) as { reason?: string }).toMatchObject({ ok: false, reason: 'revoked' });
    expect((await loadPublicFormByCode(seed().asClient(), 'zzzzzzzzzz')) as { reason?: string }).toMatchObject({ ok: false, reason: 'not_found' });
  });

  it('marks an expired pending link expired and audits link.expired', async () => {
    const fake = seed({ expires_at: past() });
    const res = await loadPublicFormByCode(fake.asClient(), CODE);
    expect(res.ok).toBe(false);
    expect((fake.tables.compliance_form_links ?? [])[0]!.status).toBe('expired');
    expect((fake.tables.compliance_audit_events ?? []).some((a) => a.event_type === 'link.expired')).toBe(true);
  });
});

describe('submitPublicForm', () => {
  it('captures the record, consumes the link, and audits link.consumed', async () => {
    const fake = seed();
    const res = await submitPublicForm(fake.asClient(), {
      code: CODE,
      responses: { f_name: 'Jane' },
      ip: '1.2.3.4',
      userAgent: 'jest',
    });
    expect(res.ok).toBe(true);
    const record = (fake.tables.compliance_records ?? [])[0]!;
    expect(record.guest_id).toBe(GUEST);
    expect(record.capture_channel).toBe('client_email');
    expect(record.captured_by_staff_id).toBeNull();
    expect(record.result).toBe('completed');

    const link = (fake.tables.compliance_form_links ?? [])[0]!;
    expect(link.status).toBe('consumed');
    expect(link.consumed_record_id).toBe(record.id);
    const events = (fake.tables.compliance_audit_events ?? []).map((a) => a.event_type);
    expect(events).toContain('record.captured');
    expect(events).toContain('link.consumed');
  });

  it('does not consume the link when responses are invalid', async () => {
    const fake = seed();
    const res = await submitPublicForm(fake.asClient(), { code: CODE, responses: {}, ip: null, userAgent: null });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(400);
    expect(res.fieldErrors?.f_name).toBeTruthy();
    // Link reverted to pending; no record created.
    expect((fake.tables.compliance_form_links ?? [])[0]!.status).toBe('pending');
    expect(fake.tables.compliance_records ?? []).toHaveLength(0);
  });

  it('rejects an already-consumed link', async () => {
    const fake = seed({ status: 'consumed' });
    const res = await submitPublicForm(fake.asClient(), { code: CODE, responses: { f_name: 'Jane' }, ip: null, userAgent: null });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(409);
  });

  it('rejects an expired link', async () => {
    const fake = seed({ expires_at: past() });
    const res = await submitPublicForm(fake.asClient(), { code: CODE, responses: { f_name: 'Jane' }, ip: null, userAgent: null });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(410);
  });
});

describe('submitPublicForm storage-path safety (§13.3)', () => {
  const SIG_SCHEMA: ComplianceFormSchema = {
    schema_version: '1.0',
    title: 'Consent',
    fields: [
      { id: 'f_name', type: 'text', label: 'Your name', required: true, staff_only: false },
      { id: 'f_sig', type: 'signature', label: 'Sign here', required: true, staff_only: false },
    ],
  };
  const FILE_SCHEMA: ComplianceFormSchema = {
    schema_version: '1.0',
    title: 'Upload',
    fields: [
      { id: 'f_name', type: 'text', label: 'Your name', required: true, staff_only: false },
      { id: 'f_file', type: 'file', label: 'Document', required: true, staff_only: false },
    ],
  };
  function seedSchema(schema: ComplianceFormSchema) {
    const fake = seed();
    fake.tables.compliance_type_versions = [{ id: 'v1', form_schema: schema }];
    return fake;
  }

  it('rejects a signature carrying a client-supplied storage_path (and does not consume the link)', async () => {
    const fake = seedSchema(SIG_SCHEMA);
    const res = await submitPublicForm(fake.asClient(), {
      code: CODE,
      responses: {
        f_name: 'Jane',
        f_sig: { method: 'drawn', storage_path: 'venues/evil/signatures/x.png', signed_at: '2026-01-01T00:00:00Z' },
      },
      ip: null,
      userAgent: null,
    });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(400);
    expect((fake.tables.compliance_form_links ?? [])[0]!.status).toBe('pending');
    expect(fake.tables.compliance_records ?? []).toHaveLength(0);
  });

  it('rejects a file path outside this link’s venue+code prefix', async () => {
    const fake = seedSchema(FILE_SCHEMA);
    const res = await submitPublicForm(fake.asClient(), {
      code: CODE,
      responses: {
        f_name: 'Jane',
        f_file: { storage_path: 'venues/other-venue/uploads/zzz/x.pdf', file_name: 'x.pdf', mime_type: 'application/pdf', file_size_bytes: 10 },
      },
      ip: null,
      userAgent: null,
    });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(400);
    expect((fake.tables.compliance_form_links ?? [])[0]!.status).toBe('pending');
  });

  it('accepts a file path under the correct venue+code prefix', async () => {
    const fake = seedSchema(FILE_SCHEMA);
    const res = await submitPublicForm(fake.asClient(), {
      code: CODE,
      responses: {
        f_name: 'Jane',
        f_file: { storage_path: `venues/${VENUE}/uploads/${CODE}/ok.pdf`, file_name: 'ok.pdf', mime_type: 'application/pdf', file_size_bytes: 10 },
      },
      ip: null,
      userAgent: null,
    });
    expect(res.ok).toBe(true);
    expect((fake.tables.compliance_form_links ?? [])[0]!.status).toBe('consumed');
  });
});

describe('publicServiceRequirements', () => {
  it('lists active-type requirements for a service', async () => {
    const fake = new FakeSupabase({
      venues: [{ id: VENUE, booking_model: 'unified_scheduling', enabled_models: null }],
      service_compliance_requirements: [
        { id: 'r1', venue_id: VENUE, service_item_id: 'svc-1', compliance_type_id: 't1', enforcement: 'warn_client', lock_period_hours: null },
      ],
    });
    // The !inner join to compliance_types is not resolved by the fake, so the
    // type defaults to active — assert the requirement is surfaced.
    const reqs = await publicServiceRequirements(fake.asClient(), VENUE, 'svc-1');
    expect(reqs).toHaveLength(1);
    expect(reqs[0]!.enforcement).toBe('warn_client');
  });
});
