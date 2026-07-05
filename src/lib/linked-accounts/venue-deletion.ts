/** Terminate linked-account relationships and notify partner venues before hard-delete (§6.6). */

import type { SupabaseClient } from '@supabase/supabase-js';
import { deleteCardHoldCustomersForVenue } from '@/lib/booking/card-hold-release';
import { notifyLinkPartnerVenueDeleted } from './notifications';

export interface VenueDeletionLinkPartner {
  link_id: string;
  survivor_venue_id: string;
  deleted_venue_name: string;
}

/** Parse RPC JSON from `terminate_account_links_for_venue_deletion` / `admin_hard_delete_venue`. */
export function parseVenueDeletionLinkPartners(payload: unknown): VenueDeletionLinkPartner[] {
  if (!Array.isArray(payload)) return [];
  const out: VenueDeletionLinkPartner[] = [];
  for (const row of payload) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const linkId = typeof r.link_id === 'string' ? r.link_id : '';
    const survivorId = typeof r.survivor_venue_id === 'string' ? r.survivor_venue_id : '';
    const deletedName =
      typeof r.deleted_venue_name === 'string' ? r.deleted_venue_name : 'A linked venue';
    if (linkId && survivorId) {
      out.push({
        link_id: linkId,
        survivor_venue_id: survivorId,
        deleted_venue_name: deletedName,
      });
    }
  }
  return out;
}

/** Unique survivor venue ids (one email per venue even if multiple links ended). */
export function uniqueSurvivorVenueIds(partners: VenueDeletionLinkPartner[]): string[] {
  return [...new Set(partners.map((p) => p.survivor_venue_id))];
}

/**
 * Hard-delete a venue via `admin_hard_delete_venue`, email linked partners first using
 * the partners JSON returned by the RPC (links are terminated inside the function).
 */
export async function hardDeleteVenueWithLinkedAccountNotifications(
  admin: SupabaseClient,
  venueId: string,
): Promise<{ partners: VenueDeletionLinkPartner[] }> {
  // Best-effort Stripe customer cleanup BEFORE the rows go (§9.3): the RPC
  // cascades booking_card_holds away, taking the snapshotted customer ids with
  // it. A cleanup failure never blocks the delete.
  try {
    await deleteCardHoldCustomersForVenue(admin, venueId);
  } catch (err) {
    console.error('[venue-deletion] card-hold customer cleanup failed (non-blocking)', err);
  }

  const { data, error } = await admin.rpc('admin_hard_delete_venue', {
    p_venue_id: venueId,
  });
  if (error) {
    throw new Error(`admin_hard_delete_venue: ${error.message}`);
  }

  const partners = parseVenueDeletionLinkPartners(data);
  const deletedName = partners[0]?.deleted_venue_name ?? 'A linked venue';
  const survivorIds = uniqueSurvivorVenueIds(partners);

  await Promise.allSettled(
    survivorIds.map((survivorId) =>
      notifyLinkPartnerVenueDeleted(admin, survivorId, deletedName),
    ),
  );

  return { partners };
}
