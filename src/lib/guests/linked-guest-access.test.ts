import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase', () => ({ getSupabaseAdminClient: vi.fn(() => ({ tag: 'admin' })) }));
vi.mock('@/lib/linked-accounts/queries', () => ({ resolveCallerGrantOverVenue: vi.fn() }));

import { resolveCallerGrantOverVenue } from '@/lib/linked-accounts/queries';
import { linkedOwnerVenueIdParam, resolveGuestDocumentScope } from './linked-guest-access';
import type { VenueStaff } from '@/lib/venue-auth';

const CALLER = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';
const GUEST = '33333333-3333-4333-8333-333333333333';

/** Staff client whose guest lookup succeeds only for the given venue id. */
function staffFor(guestVenueId: string | null): VenueStaff {
  const builder: Record<string, unknown> = {};
  let asked: string | null = null;
  const chain = () => builder;
  Object.assign(builder, {
    select: chain,
    eq: (col: string, val: string) => {
      if (col === 'venue_id') asked = val;
      return builder;
    },
    maybeSingle: async () => ({ data: guestVenueId && asked === guestVenueId ? { id: GUEST } : null, error: null }),
  });
  return { id: 'staff-1', venue_id: CALLER, email: 'a@b.c', role: 'admin', db: { from: () => builder } as never };
}

function req(ownerVenueId?: string) {
  const url = ownerVenueId
    ? `https://resneo.test/api/venue/guests/${GUEST}/documents?owner_venue_id=${ownerVenueId}`
    : `https://resneo.test/api/venue/guests/${GUEST}/documents`;
  return new NextRequest(url);
}

function grant(over: Partial<{ calendar: string; pii: boolean; act: string }> = {}) {
  return { linkId: 'link-1', grant: { calendar: 'full_details', pii: true, act: 'create_edit_cancel', ...over } } as never;
}

beforeEach(() => vi.clearAllMocks());

describe('linkedOwnerVenueIdParam', () => {
  it('ignores an absent, malformed or self-referencing value', () => {
    expect(linkedOwnerVenueIdParam(req(), CALLER)).toBeNull();
    expect(linkedOwnerVenueIdParam(req('not-a-uuid'), CALLER)).toBeNull();
    expect(linkedOwnerVenueIdParam(req(CALLER), CALLER)).toBeNull();
    expect(linkedOwnerVenueIdParam(req(OWNER), CALLER)).toBe(OWNER);
  });
});

/** R26 second ask: a partner's guest's Records. */
describe('resolveGuestDocumentScope', () => {
  it('scopes to the caller when no owner venue is given, without consulting any link', async () => {
    const r = await resolveGuestDocumentScope(staffFor(CALLER), req(), GUEST, 'read');
    expect(r).toEqual({ ok: true, scope: { venueId: CALLER, isOwnVenue: true, grant: null, linkId: null, auditMetadata: {} } });
    expect(vi.mocked(resolveCallerGrantOverVenue)).not.toHaveBeenCalled();
  });

  it('serves a partner read on a full_details link that shares PII, and names the acting venue for the audit', async () => {
    vi.mocked(resolveCallerGrantOverVenue).mockResolvedValue(grant({ act: 'none' }));
    const r = await resolveGuestDocumentScope(staffFor(OWNER), req(OWNER), GUEST, 'read');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.scope.venueId).toBe(OWNER);
    expect(r.scope.isOwnVenue).toBe(false);
    expect(r.scope.auditMetadata).toEqual({ acting_venue_id: CALLER, link_id: 'link-1' });
  });

  it('refuses a link that shows busy times only, or withholds personal data', async () => {
    vi.mocked(resolveCallerGrantOverVenue).mockResolvedValue(grant({ calendar: 'time_only' }));
    expect(await resolveGuestDocumentScope(staffFor(OWNER), req(OWNER), GUEST, 'read')).toMatchObject({ ok: false, status: 403 });

    vi.mocked(resolveCallerGrantOverVenue).mockResolvedValue(grant({ pii: false }));
    expect(await resolveGuestDocumentScope(staffFor(OWNER), req(OWNER), GUEST, 'read')).toMatchObject({ ok: false, status: 403 });
  });

  it('refuses any venue the caller is not linked with', async () => {
    vi.mocked(resolveCallerGrantOverVenue).mockResolvedValue(null as never);
    expect(await resolveGuestDocumentScope(staffFor(OWNER), req(OWNER), GUEST, 'read')).toMatchObject({ ok: false, status: 403 });
  });

  it('needs an edit grant to write, and full management to delete', async () => {
    vi.mocked(resolveCallerGrantOverVenue).mockResolvedValue(grant({ act: 'none' }));
    expect(await resolveGuestDocumentScope(staffFor(OWNER), req(OWNER), GUEST, 'write')).toMatchObject({ ok: false, status: 403 });

    vi.mocked(resolveCallerGrantOverVenue).mockResolvedValue(grant({ act: 'edit_existing' }));
    expect(await resolveGuestDocumentScope(staffFor(OWNER), req(OWNER), GUEST, 'write')).toMatchObject({ ok: true });
    // An "Edit existing" partner may add a file but must not destroy one the owner venue holds.
    expect(await resolveGuestDocumentScope(staffFor(OWNER), req(OWNER), GUEST, 'delete')).toMatchObject({ ok: false, status: 403 });

    vi.mocked(resolveCallerGrantOverVenue).mockResolvedValue(grant({ act: 'create_edit_cancel' }));
    expect(await resolveGuestDocumentScope(staffFor(OWNER), req(OWNER), GUEST, 'delete')).toMatchObject({ ok: true });
  });

  it('answers 404 when the guest does not belong to the resolved venue', async () => {
    vi.mocked(resolveCallerGrantOverVenue).mockResolvedValue(grant());
    // Guest lives at the caller's venue, but the request claims the partner's.
    expect(await resolveGuestDocumentScope(staffFor(CALLER), req(OWNER), GUEST, 'read')).toEqual({
      ok: false,
      status: 404,
      error: 'Guest not found',
    });
    // And the reverse: the caller's own call cannot reach a partner's guest.
    expect(await resolveGuestDocumentScope(staffFor(OWNER), req(), GUEST, 'read')).toMatchObject({ ok: false, status: 404 });
  });
});
