/**
 * "Any available" on the collective page (plan §6.17 SB-40; test FAIR-01; W19).
 *
 * A venue page picks the person for a contested time from its own "Any available" setting:
 * a random pick, or the calendar order the venue chose. The collective page used to keep whichever
 * calendar came first in a list that put the host first, so the host was handed every contested
 * time. Now the host's setting applies (it runs the page, D32): random stays random, and a chosen
 * order is followed for the calendars it names. Calendars it does not name, which is every member
 * calendar unless the host listed them, share contested times by a stable spread over the date
 * and time, so the same time always offers the same person and no venue takes them all.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  parseAnyAvailablePractitionerConfig,
  type AnyAvailablePractitionerConfig,
} from '@/lib/feature-flags/any-available-practitioner-config';
import { parseVenueFeatureFlags } from '@/lib/feature-flags';

export interface PoolableSlot {
  start_time: string;
  practitioner_id?: string | null;
}

/** The host's "Any available" setting, which the collective page follows. */
export async function loadHostAnyAvailableConfig(
  admin: SupabaseClient,
  collectiveId: string,
): Promise<AnyAvailablePractitionerConfig> {
  const { data: collective } = await admin
    .from('venue_collectives')
    .select('host_venue_id')
    .eq('id', collectiveId)
    .maybeSingle();
  if (!collective?.host_venue_id) return parseAnyAvailablePractitionerConfig(null);
  const { data: host } = await admin
    .from('venues')
    .select('feature_flags')
    .eq('id', collective.host_venue_id as string)
    .maybeSingle();
  return parseAnyAvailablePractitionerConfig(parseVenueFeatureFlags(host?.feature_flags));
}

/** A small, stable string hash (FNV-1a). */
function stableHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** The calendar that takes a contested time, by the rules above. */
export function pickCollectiveSlot<T extends PoolableSlot>(
  candidates: T[],
  config: AnyAvailablePractitionerConfig,
  date: string,
  random: () => number = Math.random,
): T | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0]!;
  if (config.mode === 'random') {
    return candidates[Math.floor(random() * candidates.length)] ?? candidates[0]!;
  }
  for (const id of config.calendar_order) {
    const named = candidates.find((c) => (c.practitioner_id ?? '') === id);
    if (named) return named;
  }
  const ordered = [...candidates].sort((a, b) => (a.practitioner_id ?? '').localeCompare(b.practitioner_id ?? ''));
  const time = candidates[0]!.start_time.slice(0, 5);
  return ordered[stableHash(`${date}|${time}`) % ordered.length]!;
}

/** One slot per start time, the calendar chosen fairly, in time order. */
export function poolCollectiveSlots<T extends PoolableSlot>(
  slots: T[],
  config: AnyAvailablePractitionerConfig,
  date: string,
  random?: () => number,
): T[] {
  const byTime = new Map<string, T[]>();
  for (const slot of slots) {
    const key = slot.start_time.slice(0, 5);
    const list = byTime.get(key) ?? [];
    list.push(slot);
    byTime.set(key, list);
  }
  const pooled: T[] = [];
  for (const candidates of byTime.values()) {
    const picked = pickCollectiveSlot(candidates, config, date, random);
    if (picked) pooled.push(picked);
  }
  return pooled.sort((a, b) => a.start_time.localeCompare(b.start_time));
}
