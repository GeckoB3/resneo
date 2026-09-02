import { describe, expect, it } from 'vitest';
import { FakeSupabase } from '@/lib/compliance/test-utils/fake-supabase';
import {
  captureBookingComplianceSubmissions,
  submissionStoragePathsAreSafe,
} from '@/lib/compliance/booking-capture';
import type { ComplianceFormSchema } from '@/lib/compliance/form-schema';
import {
  endOfCaptureDayInVenueTimezone,
  endOfLocalDayForYmd,
} from '@/lib/venue/venue-local-clock';

const VENUE = 'venue-1';
const GUEST = 'guest-1';
const DRAFT = 'draft-1';

function schemaWith(fields: Array<{ id: string; type: string; label: string }>): ComplianceFormSchema {
  return { fields } as unknown as ComplianceFormSchema;
}

describe('submissionStoragePathsAreSafe', () => {
  const prefix = `venues/${VENUE}/uploads/booking-draft/${DRAFT}/`;

  it('accepts a file path under the allowed draft prefix', () => {
    const schema = schemaWith([{ id: 'f1', type: 'file', label: 'Certificate' }]);
    const responses = { f1: { storage_path: `${prefix}abc.pdf`, file_name: 'c.pdf' } };
    expect(submissionStoragePathsAreSafe(schema, responses, prefix)).toEqual({ ok: true });
  });

  it('rejects a file path outside the allowed prefix (another draft / arbitrary object)', () => {
    const schema = schemaWith([{ id: 'f1', type: 'file', label: 'Certificate' }]);
    const responses = { f1: { storage_path: `venues/${VENUE}/uploads/booking-draft/other/abc.pdf` } };
    expect(submissionStoragePathsAreSafe(schema, responses, prefix)).toEqual({ ok: false, field: 'Certificate' });
  });

  it('rejects any file path when no draft prefix is allowed (no upload session)', () => {
    const schema = schemaWith([{ id: 'f1', type: 'file', label: 'Certificate' }]);
    const responses = { f1: { storage_path: `${prefix}abc.pdf` } };
    expect(submissionStoragePathsAreSafe(schema, responses, null)).toEqual({ ok: false, field: 'Certificate' });
  });

  it('rejects a signature that carries a client-set storage_path', () => {
    const schema = schemaWith([{ id: 's1', type: 'signature', label: 'Sign here' }]);
    const responses = { s1: { method: 'drawn', storage_path: 'venues/x/signatures/evil.png' } };
    expect(submissionStoragePathsAreSafe(schema, responses, prefix)).toEqual({ ok: false, field: 'Sign here' });
  });

  it('allows a drawn signature with inline data (no storage_path)', () => {
    const schema = schemaWith([{ id: 's1', type: 'signature', label: 'Sign here' }]);
    const responses = { s1: { method: 'drawn', data: 'data:image/png;base64,AAAA' } };
    expect(submissionStoragePathsAreSafe(schema, responses, prefix)).toEqual({ ok: true });
  });
});

describe('captureBookingComplianceSubmissions guards', () => {
  function fakeWithType(captureMethods: string[], onlineCollection = 'inline') {
    return new FakeSupabase({
      venues: [{ id: VENUE, booking_model: 'unified_scheduling', enabled_models: null }],
      service_compliance_requirements: [
        {
          id: 'r1',
          venue_id: VENUE,
          service_item_id: 'svc-1',
          appointment_service_id: 'svc-1',
          compliance_type_id: 't1',
          enforcement: 'block_online',
          lock_period_hours: null,
          online_collection: onlineCollection,
        },
      ],
      compliance_types: [
        {
          id: 't1',
          venue_id: VENUE,
          result_type: 'completed',
          validity_period_days: null,
          capture_methods: captureMethods,
          current_version_id: 'v1',
          is_active: true,
        },
      ],
      compliance_type_versions: [
        {
          id: 'v1',
          venue_id: VENUE,
          compliance_type_id: 't1',
          version_number: 1,
          form_schema: {
            schema_version: '1.0',
            title: 'Intake',
            fields: [{ id: 'note', type: 'text', label: 'Note' }],
          },
        },
      ],
      compliance_records: [],
    });
  }

  it('rejects a submission for a staff-only type (guest cannot self-certify it)', async () => {
    const fake = fakeWithType(['staff_in_venue']);
    const res = await captureBookingComplianceSubmissions(fake.asClient(), {
      venueId: VENUE,
      guestId: GUEST,
      draftId: DRAFT,
      serviceIds: ['svc-1'],
      submissions: [{ compliance_type_id: 't1', responses: {} }],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(400);
      expect(res.error).toMatch(/in venue/i);
    }
    expect(fake.tables.compliance_records ?? []).toHaveLength(0);
  });

  it('rejects a submission for an unknown type', async () => {
    const fake = fakeWithType(['client_online']);
    const res = await captureBookingComplianceSubmissions(fake.asClient(), {
      venueId: VENUE,
      guestId: GUEST,
      draftId: DRAFT,
      serviceIds: ['svc-1'],
      submissions: [{ compliance_type_id: 'does-not-exist', responses: {} }],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(400);
  });

  it('captures a client-online submission (empty form) and returns the record id', async () => {
    const fake = fakeWithType(['client_online']);
    const res = await captureBookingComplianceSubmissions(fake.asClient(), {
      venueId: VENUE,
      guestId: GUEST,
      draftId: DRAFT,
      serviceIds: ['svc-1'],
      submissions: [{ compliance_type_id: 't1', responses: {} }],
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.recordIds).toHaveLength(1);
    expect((fake.tables.compliance_records ?? []).length).toBe(1);
  });

  it('rejects a type that is not an inline requirement of the booked service (plan §3.5)', async () => {
    // Required, but collected by confirmation link: a booking-time submission is not expected.
    const byLink = fakeWithType(['client_online'], 'confirmation_link');
    const res = await captureBookingComplianceSubmissions(byLink.asClient(), {
      venueId: VENUE,
      guestId: GUEST,
      draftId: DRAFT,
      serviceIds: ['svc-1'],
      submissions: [{ compliance_type_id: 't1', responses: {} }],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(400);
      expect(res.error).toMatch(/not part of this booking/i);
    }

    // Inline, but for a different service than the one being booked.
    const otherService = fakeWithType(['client_online']);
    const res2 = await captureBookingComplianceSubmissions(otherService.asClient(), {
      venueId: VENUE,
      guestId: GUEST,
      draftId: DRAFT,
      serviceIds: ['svc-9'],
      submissions: [{ compliance_type_id: 't1', responses: {} }],
    });
    expect(res2.ok).toBe(false);
    expect((otherService.tables.compliance_records ?? []).length).toBe(0);
  });

  it('accepts a type the venue requires on all bookings, whatever service is booked (plan §4)', async () => {
    const fake = fakeWithType(['client_online']);
    fake.tables.service_compliance_requirements = [
      { id: 'v1', venue_id: VENUE, scope: 'venue', compliance_type_id: 't1', enforcement: 'block_online', online_collection: 'inline' },
    ];
    const res = await captureBookingComplianceSubmissions(fake.asClient(), {
      venueId: VENUE,
      guestId: GUEST,
      draftId: DRAFT,
      serviceIds: ['svc-anything'],
      submissions: [{ compliance_type_id: 't1', responses: {} }],
    });
    expect(res.ok).toBe(true);
  });

  it('rejects answers given against a version that is no longer current', async () => {
    const fake = fakeWithType(['client_online']);
    const res = await captureBookingComplianceSubmissions(fake.asClient(), {
      venueId: VENUE,
      guestId: GUEST,
      draftId: DRAFT,
      serviceIds: ['svc-1'],
      submissions: [{ compliance_type_id: 't1', version_id: 'v0-stale', responses: {} }],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(409);
      expect(res.error).toMatch(/updated while you were booking/i);
    }
    expect((fake.tables.compliance_records ?? []).length).toBe(0);

    const current = await captureBookingComplianceSubmissions(fakeWithType(['client_online']).asClient(), {
      venueId: VENUE,
      guestId: GUEST,
      draftId: DRAFT,
      serviceIds: ['svc-1'],
      submissions: [{ compliance_type_id: 't1', version_id: 'v1', responses: {} }],
    });
    expect(current.ok).toBe(true);
  });
});

describe('captureBookingComplianceSubmissions — per-visit forms completed during booking', () => {
  // The booking row does not exist yet at capture time, so the create routes pass the
  // appointment date down. Without it a per-visit form filled in during the booking flow
  // expired the same night and the compliance gate rejected the very booking it was
  // completed for.
  const TZ = 'Europe/London';
  const VISIT_DAY = '2027-06-10';

  function fakePerVisit() {
    return new FakeSupabase({
      venues: [{ id: VENUE, name: 'Glow Studio', timezone: TZ }],
      service_compliance_requirements: [
        {
          id: 'r1',
          venue_id: VENUE,
          service_item_id: 'svc-1',
          appointment_service_id: 'svc-1',
          compliance_type_id: 't1',
          enforcement: 'block_online',
          lock_period_hours: null,
          online_collection: 'inline',
        },
      ],
      compliance_types: [
        {
          id: 't1',
          venue_id: VENUE,
          result_type: 'signed',
          validity_period_days: 0,
          capture_methods: ['client_online'],
          current_version_id: 'v1',
          is_active: true,
        },
      ],
      compliance_type_versions: [
        {
          id: 'v1',
          venue_id: VENUE,
          compliance_type_id: 't1',
          version_number: 1,
          form_schema: {
            schema_version: '1.0',
            title: 'Treatment Consent',
            fields: [{ id: 'note', type: 'text', label: 'Note' }],
          },
        },
      ],
      compliance_records: [],
    });
  }

  it('expires at the end of the appointment day, not the day it was filled in', async () => {
    const fake = fakePerVisit();
    const res = await captureBookingComplianceSubmissions(fake.asClient(), {
      venueId: VENUE,
      guestId: GUEST,
      draftId: DRAFT,
      serviceIds: ['svc-1'],
      submissions: [{ compliance_type_id: 't1', responses: {} }],
      visitDate: VISIT_DAY,
    });
    expect(res.ok).toBe(true);
    const record = (fake.tables.compliance_records ?? [])[0] as { expires_at: string };
    expect(record.expires_at).toBe(endOfLocalDayForYmd(VISIT_DAY, TZ).toISOString());
    expect(new Date(record.expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('still captures without a visit date, expiring at the end of the capture day', async () => {
    const fake = fakePerVisit();
    const res = await captureBookingComplianceSubmissions(fake.asClient(), {
      venueId: VENUE,
      guestId: GUEST,
      draftId: DRAFT,
      serviceIds: ['svc-1'],
      submissions: [{ compliance_type_id: 't1', responses: {} }],
    });
    expect(res.ok).toBe(true);
    const record = (fake.tables.compliance_records ?? [])[0] as { expires_at: string };
    expect(record.expires_at).toBe(endOfCaptureDayInVenueTimezone(new Date(), TZ).toISOString());
  });
});
