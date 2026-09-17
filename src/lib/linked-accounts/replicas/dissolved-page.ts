/**
 * The old collective address after the collective ends (plan §6.7 "Dissolve", D25, DL4; contract 9;
 * UX spec `public.dissolved.*`, `la.row.ended`, `la.row.listOnOldPage`; W7).
 *
 * `collective_dissolve` keeps the address. For 90 days `/book/c/{slug}` shows a neutral page listing
 * the venues that were part of it when it ended, each linking to its own booking page, unless that
 * venue opted out; never a 404 and never a redirect to the host. After 90 days the address is let
 * go. The same host may take it back sooner for a new collective (DL4), and the new page then
 * simply answers at it.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { dissolvedCollectiveSlug, type CollectiveBranding } from '@/lib/linked-accounts/collectives';

export const DISSOLVED_PAGE_DAYS = 90;
const WINDOW_MS = DISSOLVED_PAGE_DAYS * 24 * 60 * 60 * 1000;

type Row = Record<string, unknown>;

export interface DissolvedPageView {
  name: string;
  branding: CollectiveBranding;
  venues: { name: string; slug: string | null }[];
}

export interface EndedCollective {
  collective_id: string;
  name: string;
  dissolved_at: string;
  list_on_old_page: boolean;
}

const withinWindow = (dissolvedAt: unknown, now: number) =>
  typeof dissolvedAt === 'string' && now - Date.parse(dissolvedAt) < WINDOW_MS;

/** The memberships that the collective's end released: left at the moment it ended. */
async function releasedAtEnd(admin: SupabaseClient, collectiveId: string, dissolvedAt: string) {
  const { data } = await admin
    .from('venue_collective_members')
    .select('id, venue_id, list_on_old_page, left_at')
    .eq('collective_id', collectiveId)
    .eq('status', 'left');
  const end = Date.parse(dissolvedAt);
  return ((data ?? []) as Row[]).filter((m) => typeof m.left_at === 'string' && Date.parse(m.left_at) === end);
}

/** The neutral page for an ended collective's address, or null when there is none to show. */
export async function loadDissolvedPage(
  admin: SupabaseClient,
  slug: string,
  opts: { now?: () => number } = {},
): Promise<DissolvedPageView | null> {
  const now = (opts.now ?? Date.now)();
  const { data: collective } = await admin
    .from('venue_collectives')
    .select('id, name, branding, booking_page_config, status, dissolved_at')
    .eq('slug', slug.toLowerCase())
    .maybeSingle();
  if (!collective || collective.status !== 'dissolved' || !withinWindow(collective.dissolved_at, now)) return null;

  const members = (await releasedAtEnd(admin, collective.id as string, collective.dissolved_at as string)).filter(
    (m) => m.list_on_old_page !== false,
  );
  const ids = members.map((m) => m.venue_id as string);
  const { data: venues } = ids.length > 0
    ? await admin.from('venues').select('id, name, slug').in('id', ids)
    : { data: [] as Row[] };
  const branding = ((collective.branding as CollectiveBranding | null) ?? {}) as CollectiveBranding;
  const brandPrimary = (collective.booking_page_config as { brand_primary?: string | null } | null)?.brand_primary;
  return {
    name: (collective.name as string) ?? 'Venue collective',
    branding: { ...branding, primary_colour: brandPrimary ?? branding.primary_colour ?? null },
    venues: ((venues ?? []) as Row[])
      .map((v) => ({ name: (v.name as string) ?? 'A venue', slug: (v.slug as string | null) ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** The ended collectives this venue was part of at the end, while their old page still shows. */
export async function loadEndedCollectivesForVenue(
  admin: SupabaseClient,
  venueId: string,
  opts: { now?: () => number } = {},
): Promise<EndedCollective[]> {
  const now = (opts.now ?? Date.now)();
  const { data: memberships } = await admin
    .from('venue_collective_members')
    .select('collective_id, list_on_old_page, left_at')
    .eq('venue_id', venueId)
    .eq('status', 'left');
  const ids = [...new Set(((memberships ?? []) as Row[]).map((m) => m.collective_id as string))];
  if (ids.length === 0) return [];
  const { data: collectives } = await admin
    .from('venue_collectives')
    .select('id, name, status, dissolved_at')
    .in('id', ids)
    .eq('status', 'dissolved');
  const ended: EndedCollective[] = [];
  for (const c of (collectives ?? []) as Row[]) {
    if (!withinWindow(c.dissolved_at, now)) continue;
    const end = Date.parse(c.dissolved_at as string);
    const mine = ((memberships ?? []) as Row[]).find(
      (m) => m.collective_id === c.id && typeof m.left_at === 'string' && Date.parse(m.left_at) === end,
    );
    if (!mine) continue;
    ended.push({
      collective_id: c.id as string,
      name: (c.name as string) ?? 'Venue collective',
      dissolved_at: c.dissolved_at as string,
      list_on_old_page: mine.list_on_old_page !== false,
    });
  }
  return ended.sort((a, b) => b.dissolved_at.localeCompare(a.dissolved_at));
}

/** Show or hide this venue on the old page. False when it was not part of the collective at the end. */
export async function setListOnOldPage(
  admin: SupabaseClient,
  collectiveId: string,
  venueId: string,
  listed: boolean,
  opts: { now?: () => number } = {},
): Promise<boolean> {
  const ended = await loadEndedCollectivesForVenue(admin, venueId, opts);
  const collective = ended.find((c) => c.collective_id === collectiveId);
  if (!collective) return false;
  const { error } = await admin
    .from('venue_collective_members')
    .update({ list_on_old_page: listed })
    .eq('collective_id', collectiveId)
    .eq('venue_id', venueId)
    .eq('status', 'left')
    .eq('left_at', collective.dissolved_at);
  if (error) throw new Error(error.message);
  return true;
}

/**
 * Let an ended collective's address go: after 90 days, or straight away when the same host starts a
 * new collective at it (DL4). The old row keeps its history under a retired address.
 */
export async function releaseDissolvedAddress(admin: SupabaseClient, collectiveId: string): Promise<void> {
  const { error } = await admin
    .from('venue_collectives')
    .update({ slug: dissolvedCollectiveSlug(collectiveId) })
    .eq('id', collectiveId)
    .eq('status', 'dissolved');
  if (error) throw new Error(error.message);
}

/** The daily sweep: every ended collective whose old page has run its 90 days. */
export async function releaseExpiredDissolvedAddresses(
  admin: SupabaseClient,
  opts: { now?: () => number } = {},
): Promise<{ released: number; errors: number }> {
  const now = (opts.now ?? Date.now)();
  const cutoff = new Date(now - WINDOW_MS).toISOString();
  const { data, error } = await admin
    .from('venue_collectives')
    .select('id, slug')
    .eq('status', 'dissolved')
    .not('dissolved_at', 'is', null)
    .lt('dissolved_at', cutoff);
  if (error) return { released: 0, errors: 1 };
  let released = 0;
  let errors = 0;
  for (const c of (data ?? []) as Row[]) {
    if (c.slug === dissolvedCollectiveSlug(c.id as string)) continue;
    try {
      await releaseDissolvedAddress(admin, c.id as string);
      released += 1;
    } catch (err) {
      errors += 1;
      console.error('[collective] could not release an ended collective address:', c.id, err);
    }
  }
  return { released, errors };
}
