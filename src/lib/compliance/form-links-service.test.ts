import { describe, expect, it } from 'vitest';
import { FakeSupabase } from '@/lib/compliance/test-utils/fake-supabase';
import {
  buildPrefillFromGuest,
  complianceFormPublicUrl,
  issueOrReuseFormLink,
  revokeFormLink,
} from '@/lib/compliance/form-links-service';
import { generateComplianceFormCode } from '@/lib/compliance/short-code';
import { DEFAULT_COMPLIANCE_CONFIG } from '@/lib/compliance/config';

const VENUE = 'venue-1';
const STAFF = 'staff-1';
const GUEST = 'guest-1';

describe('generateComplianceFormCode', () => {
  it('produces a 10-char base36 code by default', () => {
    const code = generateComplianceFormCode();
    expect(code).toHaveLength(10);
    expect(code).toMatch(/^[0-9a-z]+$/);
  });
});

describe('buildPrefillFromGuest', () => {
  it('includes only present fields and never DOB', () => {
    expect(buildPrefillFromGuest({ first_name: 'Jane', last_name: 'Doe', email: 'j@x.com', phone: null })).toEqual({
      first_name: 'Jane',
      last_name: 'Doe',
      email: 'j@x.com',
    });
    expect(buildPrefillFromGuest({})).toEqual({});
  });
});

describe('complianceFormPublicUrl', () => {
  it('builds a /p/forms/{code} url', () => {
    expect(complianceFormPublicUrl('abc123')).toMatch(/\/p\/forms\/abc123$/);
  });
});

describe('issueOrReuseFormLink', () => {
  function seedFake(extra: Record<string, unknown[]> = {}) {
    return new FakeSupabase({
      compliance_types: [{ id: 'type-1', venue_id: VENUE, current_version_id: 'ver-1', is_active: true, form_link_expiry_days: null }],
      guests: [{ id: GUEST, venue_id: VENUE, first_name: 'Jane', last_name: 'Doe', email: 'jane@x.com', phone: '+447700900000' }],
      ...extra,
    });
  }

  it('creates a new link with prefill and audits link.issued', async () => {
    const fake = seedFake();
    const res = await issueOrReuseFormLink(fake.asClient(), {
      venueId: VENUE, staffId: STAFF, guestId: GUEST, complianceTypeId: 'type-1', config: DEFAULT_COMPLIANCE_CONFIG,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.reused).toBe(false);
      expect(res.value.publicUrl).toContain('/p/forms/');
      const link = (fake.tables.compliance_form_links ?? [])[0]!;
      expect(link.compliance_type_version_id).toBe('ver-1');
      expect(link.status).toBe('pending');
      expect((link.prefill as Record<string, string>).email).toBe('jane@x.com');
    }
    expect((fake.tables.compliance_audit_events ?? []).some((a) => a.event_type === 'link.issued')).toBe(true);
  });

  it('reuses an existing pending, unexpired link for the same (guest, type)', async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const fake = seedFake({
      compliance_form_links: [
        { id: 'existing', venue_id: VENUE, guest_id: GUEST, compliance_type_id: 'type-1', status: 'pending', code: 'reuseme123', expires_at: future, created_at: '2026-01-01' },
      ],
    });
    const res = await issueOrReuseFormLink(fake.asClient(), {
      venueId: VENUE, staffId: STAFF, guestId: GUEST, complianceTypeId: 'type-1', config: DEFAULT_COMPLIANCE_CONFIG,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.reused).toBe(true);
      expect(res.value.publicUrl).toContain('reuseme123');
    }
    // No new link inserted.
    expect(fake.tables.compliance_form_links ?? []).toHaveLength(1);
  });

  it('does not reuse an expired pending link', async () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const fake = seedFake({
      compliance_form_links: [
        { id: 'old', venue_id: VENUE, guest_id: GUEST, compliance_type_id: 'type-1', status: 'pending', code: 'oldcode123', expires_at: past, created_at: '2026-01-01' },
      ],
    });
    const res = await issueOrReuseFormLink(fake.asClient(), {
      venueId: VENUE, staffId: STAFF, guestId: GUEST, complianceTypeId: 'type-1', config: DEFAULT_COMPLIANCE_CONFIG,
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.reused).toBe(false);
    expect(fake.tables.compliance_form_links ?? []).toHaveLength(2);
  });
});

describe('revokeFormLink', () => {
  it('revokes a pending link and audits link.revoked', async () => {
    const fake = new FakeSupabase({
      compliance_form_links: [{ id: 'l1', venue_id: VENUE, status: 'pending', guest_id: GUEST, compliance_type_id: 'type-1' }],
    });
    const res = await revokeFormLink(fake.asClient(), { venueId: VENUE, staffId: STAFF, linkId: 'l1' });
    expect(res.ok).toBe(true);
    expect((fake.tables.compliance_form_links ?? [])[0]!.status).toBe('revoked');
    expect((fake.tables.compliance_audit_events ?? []).some((a) => a.event_type === 'link.revoked')).toBe(true);
  });

  it('409s when the link is already consumed', async () => {
    const fake = new FakeSupabase({
      compliance_form_links: [{ id: 'l1', venue_id: VENUE, status: 'consumed', guest_id: GUEST, compliance_type_id: 'type-1' }],
    });
    const res = await revokeFormLink(fake.asClient(), { venueId: VENUE, staffId: STAFF, linkId: 'l1' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(409);
  });
});
