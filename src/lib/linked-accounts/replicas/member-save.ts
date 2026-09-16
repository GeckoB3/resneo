/**
 * What a member may change about a service its host manages (plan Appendix E contract 4, the member
 * half; UX spec §2 item 3; W6).
 *
 * A replica's own columns belong to the host, and the engine's locks refuse a change to any of them
 * (RN001). The route checks first so the member reads a sentence rather than a database refusal,
 * and so a save that only touches the member's own things goes through untouched.
 *
 * The list is small on purpose: which of the member's calendars offer it, and the things only the
 * member can know, which today is the online meeting link and its joining information. Everything
 * else is the host's.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

/** Keys a member's save may carry for a service its host manages. */
export const MEMBER_EDITABLE_SERVICE_KEYS = [
  'online_meeting_url',
  'online_meeting_info',
  // Venue-class columns the app cannot edit anywhere yet (D40, D53). Listed so a build that gains
  // the fields is not refused by this guard the day it ships.
  'capacity_per_session',
  'pre_appointment_instructions',
] as const;

/** Keys that are not part of the service itself: the calendar choice, and the stale checks. */
const NOT_SERVICE_FIELDS = new Set([
  'id',
  'practitioner_ids',
  'expected_updated_at',
  'expected_calendar_ids',
]);

export interface MemberServiceContext {
  collectiveId: string;
  collectiveName: string;
  hostVenueName: string;
  /** 'replica' while the host still offers it; 'retired' once the host has taken it off the page. */
  role: 'replica' | 'retired';
}

/**
 * The collective's hold on this service, when the venue saving it is a member holding a copy.
 * Null for the venue's own service, and at every venue outside a live replicas-model collective.
 */
export async function loadMemberServiceContext(
  admin: SupabaseClient,
  serviceId: string,
  venueId: string,
): Promise<MemberServiceContext | null> {
  const { data: link } = await admin
    .from('collective_service_replicas')
    .select('id, collective_id, collective_service_item_id, venue_id')
    .eq('replica_service_id', serviceId)
    .eq('venue_id', venueId)
    .is('released_at', null)
    .maybeSingle();
  if (!link) return null;

  const [{ data: collective }, { data: item }] = await Promise.all([
    admin
      .from('venue_collectives')
      .select('id, name, status, service_model, host_venue_id, venues:host_venue_id (name)')
      .eq('id', link.collective_id as string)
      .maybeSingle(),
    admin
      .from('collective_service_items')
      .select('status')
      .eq('id', link.collective_service_item_id as string)
      .maybeSingle(),
  ]);
  if (!collective || collective.status !== 'active' || collective.service_model !== 'replicas') return null;
  const hostVenue = (collective.venues ?? null) as { name?: string } | { name?: string }[] | null;
  return {
    collectiveId: collective.id as string,
    collectiveName: (collective.name as string) ?? 'your collective',
    hostVenueName: (Array.isArray(hostVenue) ? hostVenue[0]?.name : hostVenue?.name) ?? 'the host',
    role: item?.status === 'active' ? 'replica' : 'retired',
  };
}

/**
 * The fields of this save the host owns. Empty when the member is only changing its own things, so
 * the save goes through; otherwise the route answers 409 COLLECTIVE_MANAGED_SERVICE and names them.
 */
export function hostOwnedFieldsInSave(
  body: Record<string, unknown>,
  currentRow: Record<string, unknown>,
): string[] {
  const editable = new Set<string>(MEMBER_EDITABLE_SERVICE_KEYS);
  const refused: string[] = [];
  for (const [key, value] of Object.entries(body)) {
    if (NOT_SERVICE_FIELDS.has(key) || editable.has(key)) continue;
    // Re-sending the value a field already has is not a change. Older app builds send the whole
    // service back on every save, so a calendar-only edit must not be refused for the rest.
    if (sameValue(value, currentRow[key])) continue;
    refused.push(key);
  }
  return refused;
}

/** Equal for this purpose: the same after the shapes the API and the database differ on. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  // A cleared text field is '' on the way in and null in the row, and 0 pence is stored as null.
  if ((a === '' || a === 0) && b == null) return true;
  if ((b === '' || b === 0) && a == null) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => sameValue(item, b[i]));
  }
  if (typeof a === 'object' && typeof b === 'object' && a && b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

interface VariantInput {
  id?: string;
  name: string;
  description?: string | null;
  duration_minutes: number;
  buffer_minutes?: number;
  price_pence?: number | null;
  deposit_pence?: number | null;
  is_active?: boolean;
  processing_time_blocks?: unknown;
}

const VARIANT_FIELDS = ['name', 'description', 'duration_minutes', 'buffer_minutes', 'price_pence', 'deposit_pence', 'is_active'] as const;

const emptyBlocks = (value: unknown) => value == null || (Array.isArray(value) && value.length === 0);

/**
 * Whether the options and add-on links a save re-sends are the ones the member's copy already has.
 * Each is true when it was not sent. Options are matched by id, so a new or removed option is a
 * change; add-on links by group and order.
 */
export async function memberRelationsUnchanged(
  admin: SupabaseClient,
  serviceId: string,
  sent: { variants?: VariantInput[]; addonLinks?: { addon_group_id: string; sort_order?: number }[] },
): Promise<{ variants: boolean; addonLinks: boolean }> {
  let variants = true;
  if (sent.variants) {
    const { data } = await admin.from('service_variants').select('*').eq('service_item_id', serviceId);
    const stored = new Map(((data ?? []) as Record<string, unknown>[]).map((row) => [row.id as string, row]));
    variants =
      sent.variants.length === stored.size &&
      sent.variants.every((v) => {
        const row = v.id ? stored.get(v.id) : undefined;
        if (!row) return false;
        const fieldsSame = VARIANT_FIELDS.every((field) => {
          const incoming = (v as unknown as Record<string, unknown>)[field];
          if (incoming === undefined) return true;
          if (field === 'is_active') return (incoming !== false) === (row.is_active !== false);
          if (field === 'buffer_minutes') return Number(incoming ?? 0) === Number(row.buffer_minutes ?? 0);
          return sameValue(incoming, row[field]);
        });
        const blocksSame =
          v.processing_time_blocks === undefined ||
          (emptyBlocks(v.processing_time_blocks) && emptyBlocks(row.processing_time_blocks)) ||
          sameValue(v.processing_time_blocks, row.processing_time_blocks);
        return fieldsSame && blocksSame;
      });
  }
  let addonLinks = true;
  if (sent.addonLinks) {
    const { data } = await admin
      .from('service_addon_groups')
      .select('addon_group_id, sort_order')
      .eq('service_item_id', serviceId)
      .order('sort_order', { ascending: true });
    const stored = ((data ?? []) as Record<string, unknown>[]).map((row) => row.addon_group_id as string);
    const incoming = [...new Set(sent.addonLinks.map((link) => link.addon_group_id))];
    addonLinks = incoming.length === stored.length && incoming.every((groupId, i) => groupId === stored[i]);
  }
  return { variants, addonLinks };
}
