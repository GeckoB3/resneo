/**
 * Venue settings a collective depends on (plan §6 graft 4, D8; UX spec `profile.timezone.*`,
 * `bm.model.locked`, `bm.currency.blocked`; tests TERMS-15 and BM-02, BM-04; W7).
 *
 * Every venue in a collective shares one timezone and one currency, and the page shows
 * appointments only. A venue could otherwise break that from its own settings: a timezone change
 * made the combined page quietly refuse to render, a currency change relabelled its prices on the
 * page without converting them, and switching appointments off left calendars on the page with
 * nothing behind them. So while a venue is part of a live collective, `PATCH /api/venue` and
 * onboarding refuse those changes with a code and a sentence that says what to do.
 *
 * "Part of" is any active membership of an active collective, hosting included, whether or not
 * the page is currently able to render: a venue whose page is already down should not be able to
 * move further from its partners.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api/error-codes';
import { collectiveCopy } from '@/lib/linked-accounts/collective-copy';
import { currencyMismatchWords, normalCurrency } from '@/lib/linked-accounts/collective-currency';

export interface VenueCollectiveLock {
  collectiveId: string;
  collectiveName: string;
  hostVenueId: string;
}

/**
 * The active collective the venue is part of, or null. `exceptCollectiveId` leaves one out, which is
 * how exclusivity asks "is it in any other?" (plan §6.7, I7).
 */
export async function findCollectiveLockForVenue(
  admin: SupabaseClient,
  venueId: string,
  exceptCollectiveId?: string,
): Promise<VenueCollectiveLock | null> {
  const { data: memberships } = await admin
    .from('venue_collective_members')
    .select('collective_id')
    .eq('venue_id', venueId)
    .eq('status', 'active');
  const { data: hosted } = await admin
    .from('venue_collectives')
    .select('id')
    .eq('host_venue_id', venueId)
    .eq('status', 'active');
  const ids = [
    ...new Set([
      ...(memberships ?? []).map((m) => m.collective_id as string),
      ...(hosted ?? []).map((c) => c.id as string),
    ]),
  ].filter((id) => Boolean(id) && id !== exceptCollectiveId);
  if (ids.length === 0) return null;
  const { data: collectives } = await admin
    .from('venue_collectives')
    .select('id, name, host_venue_id, status')
    .in('id', ids)
    .eq('status', 'active')
    .order('id')
    .limit(1);
  const row = (collectives ?? [])[0];
  if (!row) return null;
  return {
    collectiveId: row.id as string,
    collectiveName: (row.name as string | null) ?? 'your collective',
    hostVenueId: row.host_venue_id as string,
  };
}

const sameTimezone = (a: string | null | undefined, b: string | null | undefined) =>
  (a?.trim() || 'Europe/London') === (b?.trim() || 'Europe/London');

/** A venue already in another live collective cannot be invited to this one: the 409, or null. */
export async function exclusivityRefusal(
  admin: SupabaseClient,
  venueIds: string[],
  exceptCollectiveId: string | undefined,
  as: 'invite' | 'accept',
): Promise<NextResponse | null> {
  for (const venueId of venueIds) {
    const other = await findCollectiveLockForVenue(admin, venueId, exceptCollectiveId);
    if (!other) continue;
    let error: string;
    if (as === 'accept') {
      error = collectiveCopy('join.block.otherCollective', { otherCollective: other.collectiveName });
    } else {
      const { data: venue } = await admin.from('venues').select('name').eq('id', venueId).maybeSingle();
      error = collectiveCopy('invite.block.otherCollective', { venue: (venue?.name as string | undefined) ?? 'That venue' });
    }
    return NextResponse.json(apiError(error, 'COLLECTIVE_VENUE_IN_OTHER_COLLECTIVE'), { status: 409 });
  }
  return null;
}

/** A timezone change while in a collective: the 409 to send, or null. */
export function timezoneLockRefusal(
  lock: VenueCollectiveLock | null,
  stored: string | null | undefined,
  next: string | null | undefined,
): NextResponse | null {
  if (!lock || next === undefined || sameTimezone(stored, next)) return null;
  return NextResponse.json(
    apiError(collectiveCopy('profile.timezone.error', { collective: lock.collectiveName }), 'COLLECTIVE_TIMEZONE_LOCKED'),
    { status: 409 },
  );
}

/** Switching appointments off while in a collective: the 409 to send, or null. */
export function bookingModelLockRefusal(
  lock: VenueCollectiveLock | null,
  venueName: string,
  removedModels: readonly string[],
): NextResponse | null {
  if (!lock || !removedModels.includes('unified_scheduling')) return null;
  return NextResponse.json(
    apiError(collectiveCopy('bm.model.locked', { venue: venueName }), 'COLLECTIVE_BOOKING_MODEL_LOCKED'),
    { status: 409 },
  );
}

/**
 * A currency change while in a collective: the 409 to send, or null. The collective's currency is
 * its host's, so a host changing its own currency is refused the same way.
 */
export async function currencyLockRefusal(
  admin: SupabaseClient,
  lock: VenueCollectiveLock | null,
  venue: { id: string; name: string; currency: string | null | undefined },
  next: string | null | undefined,
): Promise<NextResponse | null> {
  if (!lock || next === undefined || normalCurrency(next) === normalCurrency(venue.currency)) return null;
  let hostCurrency = venue.currency;
  if (lock.hostVenueId !== venue.id) {
    const { data: host } = await admin.from('venues').select('currency').eq('id', lock.hostVenueId).maybeSingle();
    hostCurrency = (host?.currency as string | null | undefined) ?? null;
  }
  return NextResponse.json(
    apiError(currencyMismatchWords(venue.name, next, hostCurrency), 'COLLECTIVE_CURRENCY_MISMATCH'),
    { status: 409 },
  );
}
