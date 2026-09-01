import { describe, expect, it } from 'vitest';
import { FakeSupabase } from '@/lib/compliance/test-utils/fake-supabase';
import {
  loadPublicFormByCode,
  publicBookingRequirements,
  stripStaffOnlyFields,
  submitPublicForm,
} from '@/lib/compliance/public-forms-service';
import type { ComplianceFormSchema } from '@/lib/compliance/form-schema';
import {
  endOfCaptureDayInVenueTimezone,
  endOfLocalDayForYmd,
} from '@/lib/venue/venue-local-clock';

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

describe('publicBookingRequirements (booking page, plan §3)', () => {
  const NOW = new Date('2026-09-01T10:00:00Z');
  const inTwoDays = { bookingDate: '2026-09-03', bookingTime: '10:00' };

  function seedBooking(opts: {
    requirements?: Array<Record<string, unknown>>;
    records?: Array<Record<string, unknown>>;
    enabled?: boolean;
    inline?: boolean;
    lockHours?: number | null;
  } = {}) {
    const inline = opts.inline ?? true;
    return new FakeSupabase({
      venues: [
        {
          id: VENUE,
          booking_model: 'unified_scheduling',
          enabled_models: null,
          pricing_tier: opts.enabled === false ? null : 'appointments',
          feature_flags: { compliance_records_enabled: opts.enabled !== false },
        },
      ],
      service_compliance_requirements: opts.requirements ?? [
        {
          id: 'r1',
          venue_id: VENUE,
          service_item_id: 'svc-1',
          compliance_type_id: 't1',
          enforcement: 'block_online',
          lock_period_hours: opts.lockHours ?? null,
          online_collection: inline ? 'inline' : 'confirmation_link',
        },
      ],
      compliance_types: [
        {
          id: 't1',
          venue_id: VENUE,
          name: 'Consent',
          is_active: true,
          capture_methods: ['client_online', 'staff_in_venue'],
          online_unmet_message: null,
          current_version_id: 'v1',
          validity_period_days: null,
          result_type: 'completed',
        },
      ],
      compliance_type_versions: [{ id: 'v1', venue_id: VENUE, compliance_type_id: 't1', form_schema: SCHEMA }],
      guests: [{ id: GUEST, venue_id: VENUE, email: 'jane@x.com' }],
      compliance_records: opts.records ?? [],
    });
  }

  const validRecord = (captured: string) => ({
    id: 'rec-1',
    venue_id: VENUE,
    guest_id: GUEST,
    compliance_type_id: 't1',
    status: 'completed',
    expires_at: null,
    voided_at: null,
    captured_at: captured,
    result: null,
    captured_by_staff_id: null,
  });

  it('with no email: lists the requirement with no state and no form', async () => {
    const res = await publicBookingRequirements(seedBooking().asClient(), {
      venueId: VENUE,
      serviceIds: ['svc-1'],
      now: NOW,
      ...inTwoDays,
    });
    expect(res.identity_known).toBe(false);
    expect(res.requirements).toHaveLength(1);
    expect(res.requirements[0]).toMatchObject({ compliance_type_id: 't1', state: null, form: null, client_online: true });
  });

  it('a returning customer with a valid record is SATISFIED and gets no form', async () => {
    const res = await publicBookingRequirements(seedBooking({ records: [validRecord('2026-08-01T10:00:00Z')] }).asClient(), {
      venueId: VENUE,
      serviceIds: ['svc-1'],
      email: '  Jane@X.com ',
      now: NOW,
      ...inTwoDays,
    });
    expect(res.identity_known).toBe(true);
    expect(res.requirements[0]).toMatchObject({ state: 'SATISFIED', form: null });
  });

  it('a new customer is MISSING and gets the inline form with staff_only fields stripped', async () => {
    const res = await publicBookingRequirements(seedBooking().asClient(), {
      venueId: VENUE,
      serviceIds: ['svc-1'],
      email: 'someone-new@x.com',
      now: NOW,
      ...inTwoDays,
    });
    expect(res.identity_known).toBe(true);
    const req = res.requirements[0]!;
    expect(req.state).toBe('MISSING');
    expect(req.form?.version_id).toBe('v1');
    expect(req.form?.form_schema.fields.map((f) => f.id)).toEqual(['f_name']);
  });

  it('a phone-only or differently-addressed returning customer reads as MISSING (mirrors booking creation)', async () => {
    const res = await publicBookingRequirements(seedBooking({ records: [validRecord('2026-08-01T10:00:00Z')] }).asClient(), {
      venueId: VENUE,
      serviceIds: ['svc-1'],
      email: 'jane.other@x.com',
      now: NOW,
      ...inTwoDays,
    });
    expect(res.requirements[0]!.state).toBe('MISSING');
    expect(res.requirements[0]!.form).not.toBeNull();
  });

  it('does not offer a form when the type is collected by link rather than inline', async () => {
    const res = await publicBookingRequirements(seedBooking({ inline: false }).asClient(), {
      venueId: VENUE,
      serviceIds: ['svc-1'],
      email: 'someone-new@x.com',
      now: NOW,
      ...inTwoDays,
    });
    expect(res.requirements[0]).toMatchObject({ state: 'MISSING', online_collection: 'confirmation_link', form: null });
  });

  it('judges the lock period against the chosen slot: too close to book means LOCK_PASSED and no form', async () => {
    const res = await publicBookingRequirements(seedBooking({ lockHours: 72 }).asClient(), {
      venueId: VENUE,
      serviceIds: ['svc-1'],
      email: 'someone-new@x.com',
      now: NOW,
      ...inTwoDays, // 48h away, inside a 72h lock
    });
    expect(res.requirements[0]).toMatchObject({ state: 'LOCK_PASSED', form: null });

    const later = await publicBookingRequirements(seedBooking({ lockHours: 24 }).asClient(), {
      venueId: VENUE,
      serviceIds: ['svc-1'],
      email: 'someone-new@x.com',
      now: NOW,
      ...inTwoDays, // 48h away, outside a 24h lock
    });
    expect(later.requirements[0]).toMatchObject({ state: 'MISSING' });
    expect(later.requirements[0]!.form).not.toBeNull();
  });

  it('merges a type required by two services: strictest enforcement, worst state, asked once', async () => {
    const fake = seedBooking({
      requirements: [
        { id: 'r1', venue_id: VENUE, service_item_id: 'svc-1', compliance_type_id: 't1', enforcement: 'warn_client', lock_period_hours: null, online_collection: 'inline' },
        { id: 'r2', venue_id: VENUE, service_item_id: 'svc-2', compliance_type_id: 't1', enforcement: 'block_online', lock_period_hours: null, online_collection: 'confirmation_link' },
      ],
    });
    const res = await publicBookingRequirements(fake.asClient(), {
      venueId: VENUE,
      serviceIds: ['svc-1', 'svc-2'],
      email: 'someone-new@x.com',
      now: NOW,
      ...inTwoDays,
    });
    expect(res.requirements).toHaveLength(1);
    expect(res.requirements[0]).toMatchObject({ enforcement: 'block_online', online_collection: 'inline', state: 'MISSING' });
    expect(res.requirements[0]!.form).not.toBeNull();
  });

  it('applies a venue-wide (all bookings) requirement to any service, and lets a service row win (plan §4)', async () => {
    const venueWideOnly = seedBooking({
      requirements: [
        { id: 'v1', venue_id: VENUE, scope: 'venue', compliance_type_id: 't1', enforcement: 'block_online', lock_period_hours: null, online_collection: 'inline' },
      ],
    });
    const res = await publicBookingRequirements(venueWideOnly.asClient(), {
      venueId: VENUE,
      serviceIds: ['svc-any'],
      email: 'someone-new@x.com',
      now: NOW,
      ...inTwoDays,
    });
    expect(res.requirements).toHaveLength(1);
    expect(res.requirements[0]).toMatchObject({ scope: 'venue', enforcement: 'block_online', state: 'MISSING' });
    expect(res.requirements[0]!.form).not.toBeNull();

    const both = seedBooking({
      requirements: [
        { id: 'v1', venue_id: VENUE, scope: 'venue', compliance_type_id: 't1', enforcement: 'block_all', lock_period_hours: null, online_collection: 'inline' },
        { id: 's1', venue_id: VENUE, service_item_id: 'svc-1', compliance_type_id: 't1', enforcement: 'warn_client', lock_period_hours: null, online_collection: 'inline' },
      ],
    });
    const res2 = await publicBookingRequirements(both.asClient(), {
      venueId: VENUE,
      serviceIds: ['svc-1'],
      email: 'someone-new@x.com',
      now: NOW,
      ...inTwoDays,
    });
    expect(res2.requirements).toHaveLength(1);
    expect(res2.requirements[0]).toMatchObject({ scope: 'service', enforcement: 'warn_client' });
  });

  it('returns nothing when compliance is not enabled for the venue', async () => {
    const res = await publicBookingRequirements(seedBooking({ enabled: false }).asClient(), {
      venueId: VENUE,
      serviceIds: ['svc-1'],
      email: 'someone-new@x.com',
      now: NOW,
    });
    expect(res.requirements).toEqual([]);
  });
});

describe('submitPublicForm — per-visit forms completed before the appointment day', () => {
  // The reported bug: a guest who completed a per-visit form from the confirmation link,
  // days before the appointment, found it already expired on the day. The link already
  // carries `booking_id`, so expiry now runs to the end of that appointment's day.
  const TZ = 'Europe/London';
  const VISIT_DAY = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);

  function seedPerVisit(bookingOverrides: Record<string, unknown> = {}) {
    return seed(
      { booking_id: 'b1' },
      {
        compliance_types: [
          { id: 't1', venue_id: VENUE, name: 'Treatment Consent', result_type: 'signed', validity_period_days: 0 },
        ],
        venues: [
          {
            id: VENUE,
            name: 'Glow Studio',
            timezone: TZ,
            booking_model: 'unified_scheduling',
            enabled_models: null,
          },
        ],
        bookings: [
          { id: 'b1', venue_id: VENUE, booking_date: VISIT_DAY, booking_time: '09:00:00', ...bookingOverrides },
        ],
      },
    );
  }

  it('expires at the end of the booked appointment day, so it is still valid on the day', async () => {
    const fake = seedPerVisit();
    const res = await submitPublicForm(fake.asClient(), {
      code: CODE,
      responses: { f_name: 'Jane' },
      ip: null,
      userAgent: null,
    });
    expect(res.ok).toBe(true);
    const record = (fake.tables.compliance_records ?? [])[0] as { expires_at: string; booking_id: string };
    expect(record.booking_id).toBe('b1');
    expect(record.expires_at).toBe(endOfLocalDayForYmd(VISIT_DAY, TZ).toISOString());
    expect(new Date(record.expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('falls back to the capture day for a link with no booking attached', async () => {
    const fake = seed(
      { booking_id: null },
      {
        compliance_types: [
          { id: 't1', venue_id: VENUE, name: 'Treatment Consent', result_type: 'signed', validity_period_days: 0 },
        ],
        venues: [{ id: VENUE, name: 'Glow Studio', timezone: TZ, booking_model: 'unified_scheduling', enabled_models: null }],
      },
    );
    const res = await submitPublicForm(fake.asClient(), {
      code: CODE,
      responses: { f_name: 'Jane' },
      ip: null,
      userAgent: null,
    });
    expect(res.ok).toBe(true);
    const record = (fake.tables.compliance_records ?? [])[0] as { expires_at: string };
    expect(record.expires_at).toBe(endOfCaptureDayInVenueTimezone(new Date(), TZ).toISOString());
  });
});
