import { describe, expect, it } from 'vitest';
import { FakeSupabase } from '@/lib/compliance/test-utils/fake-supabase';
import {
  captureBookingComplianceSubmissions,
  submissionStoragePathsAreSafe,
} from '@/lib/compliance/booking-capture';
import type { ComplianceFormSchema } from '@/lib/compliance/form-schema';

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
  function fakeWithType(captureMethods: string[]) {
    return new FakeSupabase({
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
      submissions: [{ compliance_type_id: 't1', responses: {} }],
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.recordIds).toHaveLength(1);
    expect((fake.tables.compliance_records ?? []).length).toBe(1);
  });
});
