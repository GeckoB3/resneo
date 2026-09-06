import type { NextRequest } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { resolveCallerGrantOverVenue } from '@/lib/linked-accounts/queries';
import type { LinkGrant } from '@/lib/linked-accounts/types';
import { linkedGrantAllowsCancel, linkedGrantAllowsMutation } from '@/lib/booking/staff-booking-access';
import type { VenueStaff } from '@/lib/venue-auth';

/**
 * Scoping for a guest's documents when the guest belongs to a LINKED venue (R26 second ask).
 *
 * The Records card on a booking detail panel reads the caller's own venue until the booking
 * sits on a partner's calendar column, at which point the guest, the `guest_documents` rows
 * and the storage objects all belong to the OWNER venue. These routes therefore accept
 * `owner_venue_id`, exactly as `bookings/list` does for a partner's guest history, and
 * resolve the link grant the owner venue authored.
 *
 * The gates, in the order they are applied:
 * - `full_details` calendar visibility, because a document is per-person detail and a
 *   `time_only` link sees anonymous busy blocks only (§5.1);
 * - `grant.pii`, because a document IS the person's personal data. A full_details link that
 *   withholds PII shows a booking without guest identity, so it must not read their files;
 * - reads (list, download) stop there;
 * - writes (sign, complete) additionally need an edit grant;
 * - delete additionally needs the FULL MANAGEMENT grant, matching every other destructive
 *   cross-venue action in the codebase (booking cancel and booking delete both use
 *   `linkedGrantAllowsCancel`). An "Edit existing" partner can add a file but cannot destroy
 *   one the owner venue holds.
 *
 * The owner venue's id is what the caller then writes with, so the storage path,
 * `guest_documents.venue_id` and the contact audit event all stay the owner's; the acting
 * venue and link id go into the audit metadata.
 */

export type GuestScopeAction = 'read' | 'write' | 'delete';

export interface GuestScope {
  /** The venue that owns the guest, their documents and the storage objects. */
  venueId: string;
  isOwnVenue: boolean;
  grant: LinkGrant | null;
  linkId: string | null;
  /** Spread into a contact audit event's metadata; empty for an own-venue call. */
  auditMetadata: Record<string, unknown>;
}

export type GuestScopeResult = { ok: true; scope: GuestScope } | { ok: false; status: 403 | 404; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The `owner_venue_id` query parameter, when it names another venue. */
export function linkedOwnerVenueIdParam(request: NextRequest, callerVenueId: string): string | null {
  const raw = request.nextUrl.searchParams.get('owner_venue_id');
  if (!raw || !UUID_RE.test(raw) || raw === callerVenueId) return null;
  return raw;
}

export const LINKED_GUEST_NO_ACCESS = 'You do not have access to that venue’s client records.';
export const LINKED_GUEST_NO_WRITE = 'This link does not allow changing the other venue’s client records.';
export const LINKED_GUEST_NO_DELETE = 'This link does not allow deleting the other venue’s client records.';

/**
 * Resolve which venue a guest-documents request acts as, and refuse when the link does not
 * carry enough. Returns 404 (not 403) when the guest does not belong to the resolved venue,
 * so an unrelated guest id cannot be probed for existence.
 */
export async function resolveGuestDocumentScope(
  staff: VenueStaff,
  request: NextRequest,
  guestId: string,
  action: GuestScopeAction,
): Promise<GuestScopeResult> {
  const ownerVenueId = linkedOwnerVenueIdParam(request, staff.venue_id);

  let scope: GuestScope;
  if (!ownerVenueId) {
    scope = { venueId: staff.venue_id, isOwnVenue: true, grant: null, linkId: null, auditMetadata: {} };
  } else {
    const access = await resolveCallerGrantOverVenue(getSupabaseAdminClient(), staff.venue_id, ownerVenueId);
    if (!access || access.grant.calendar !== 'full_details' || !access.grant.pii) {
      return { ok: false, status: 403, error: LINKED_GUEST_NO_ACCESS };
    }
    if (action === 'write' && !linkedGrantAllowsMutation(access.grant, false)) {
      return { ok: false, status: 403, error: LINKED_GUEST_NO_WRITE };
    }
    if (action === 'delete' && !linkedGrantAllowsCancel(access.grant, false)) {
      return { ok: false, status: 403, error: LINKED_GUEST_NO_DELETE };
    }
    scope = {
      venueId: ownerVenueId,
      isOwnVenue: false,
      grant: access.grant,
      linkId: access.linkId,
      auditMetadata: { acting_venue_id: staff.venue_id, link_id: access.linkId },
    };
  }

  // The guest must belong to the venue we resolved, own or linked.
  const { data: guest, error } = await staff.db
    .from('guests')
    .select('id')
    .eq('id', guestId)
    .eq('venue_id', scope.venueId)
    .maybeSingle();
  if (error || !guest) {
    return { ok: false, status: 404, error: 'Guest not found' };
  }

  return { ok: true, scope };
}
