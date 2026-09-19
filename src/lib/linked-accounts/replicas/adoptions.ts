/**
 * Host-initiated adoption, "Add from another venue" (plan §6.7; contracts 1 and 10; UX spec
 * `svc.addFrom.*`, `svc.member.adopt.*`, N26; test OFF-06; W7).
 *
 *   ownServicesAt          the member's services the host may pick: its own, active, not a copy;
 *   runAddFromVenue        the engine copies one into a new host service, offers it, and asks the
 *                          member (N26 is queued by the engine and sent by the notice drain);
 *   loadPendingAdoptions   what a member has still to answer;
 *   loadAdoptionReview     one question, with both sides' options for the mapping;
 *   runAnswerAdoption      the member's answer: use its own service, or keep it separate;
 *   runAdoptionDeadlines   the reminder at day 7 and "Keep mine separate" at day 14.
 *
 * Pending is the engine's own rule (`collective_adoption_pending`), read from the audit.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { engineErrorResponse } from '@/lib/linked-accounts/replicas/host-route-helpers';
import { applyLinksInline, type CollectiveSync } from '@/lib/linked-accounts/replicas/inline-apply';
import { notifyServiceOffered } from '@/lib/linked-accounts/replicas/collective-notices';
import { sameName } from '@/lib/linked-accounts/replicas/join';

const DAY_MS = 24 * 60 * 60 * 1000;
export const ADOPTION_REMIND_AFTER_MS = 7 * DAY_MS;
export const ADOPTION_DEFAULT_AFTER_MS = 14 * DAY_MS;
/** Requests older than this are long settled; the deadline job does not look further back. */
const LOOKBACK_MS = 30 * DAY_MS;

type Row = Record<string, unknown>;

export interface AdoptionOption {
  id: string;
  name: string;
}

export interface OwnService {
  id: string;
  name: string;
  duration_minutes: number | null;
  price_pence: number | null;
}

export interface PendingAdoption {
  item_id: string;
  service_id: string;
  service_name: string;
  requested_at: string;
}

export interface AdoptionReview {
  item_id: string;
  collective_name: string;
  host_name: string;
  service: { id: string; name: string; options: AdoptionOption[] };
  host_options: AdoptionOption[];
  /** Each of the member's options, matched to the host's by name where one fits. */
  suggested_map: { my_variant_id: string; host_variant_id: string | null }[];
}

export interface AdoptionContext {
  admin: SupabaseClient;
  collectiveId: string;
  collectiveName: string;
  hostVenueId: string;
  hostVenueName: string;
  venueId: string;
  userId: string | null;
}

/** The member's services the host can add: active, the venue's own, not already a copy. */
export async function ownServicesAt(admin: SupabaseClient, venueId: string): Promise<OwnService[]> {
  const { data: services } = await admin
    .from('service_items')
    .select('id, name, duration_minutes, price_pence')
    .eq('venue_id', venueId)
    .eq('is_active', true)
    .order('name');
  const ids = (services ?? []).map((s) => s.id as string);
  if (ids.length === 0) return [];
  const { data: copies } = await admin
    .from('collective_service_replicas')
    .select('replica_service_id')
    .in('replica_service_id', ids)
    .is('released_at', null);
  const copied = new Set((copies ?? []).map((c) => c.replica_service_id as string));
  return (services ?? [])
    .filter((s) => !copied.has(s.id as string))
    .map((s) => ({
      id: s.id as string,
      name: (s.name as string) ?? 'Service',
      duration_minutes: (s.duration_minutes as number | null) ?? null,
      price_pence: (s.price_pence as number | null) ?? null,
    }));
}

export interface AddFromVenueResult {
  item_id: string | null;
  master_service_id: string | null;
  service_name: string;
  venue_name: string;
  collective_sync: CollectiveSync;
}

export async function runAddFromVenue(
  ctx: AdoptionContext,
  source: { venueId: string; serviceId: string },
): Promise<{ ok: true; result: AddFromVenueResult } | { ok: false; response: NextResponse }> {
  // Checked here so the host reads the reason; the engine checks again under its lock.
  const [{ data: membership }, { data: service }, { data: venue }] = await Promise.all([
    ctx.admin
      .from('venue_collective_members')
      .select('id')
      .eq('collective_id', ctx.collectiveId)
      .eq('venue_id', source.venueId)
      .eq('status', 'active')
      .maybeSingle(),
    ctx.admin.from('service_items').select('id, name, venue_id, is_active').eq('id', source.serviceId).maybeSingle(),
    ctx.admin.from('venues').select('name').eq('id', source.venueId).maybeSingle(),
  ]);
  if (!membership || source.venueId === ctx.hostVenueId) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: `That venue is not a member of ${ctx.collectiveName}.`, code: 'COLLECTIVE_VENUE_NOT_MEMBER' },
        { status: 409 },
      ),
    };
  }
  const own = (await ownServicesAt(ctx.admin, source.venueId)).some((s) => s.id === source.serviceId);
  if (!service || service.venue_id !== source.venueId || !own) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Choose one of that venue’s own services.', code: 'COLLECTIVE_OFFERING_NEEDS_HOST_SERVICE' },
        { status: 409 },
      ),
    };
  }

  const { data, error } = await ctx.admin.rpc('collective_add_from_venue', {
    p_collective_id: ctx.collectiveId,
    p_source_venue_id: source.venueId,
    p_source_service_id: source.serviceId,
    p_actor_venue_id: ctx.venueId,
    p_actor_user_id: ctx.userId,
  });
  if (error) {
    return {
      ok: false,
      response: engineErrorResponse(
        error,
        { collective: ctx.collectiveName, host: ctx.hostVenueName },
        'Could not add that service. Please try again.',
      ),
    };
  }
  const result = (data ?? {}) as {
    item_id?: string;
    master_service_id?: string;
    links?: { link_id: string; venue_id: string }[];
  };
  const links = result.links ?? [];
  const collectiveSync = await applyLinksInline(ctx.admin, links.map((l) => l.link_id), {
    actorVenueId: ctx.venueId,
    actorUserId: ctx.userId,
  });
  const serviceName = (service.name as string) ?? 'A service';
  // N8 for the other members; the venue that was asked hears through N26 instead.
  await notifyServiceOffered(ctx.admin, {
    memberVenueIds: links.map((l) => l.venue_id),
    collectiveId: ctx.collectiveId,
    collectiveName: ctx.collectiveName,
    hostVenueId: ctx.hostVenueId,
    hostVenueName: ctx.hostVenueName,
    serviceName,
  });
  return {
    ok: true,
    result: {
      item_id: result.item_id ?? null,
      master_service_id: result.master_service_id ?? null,
      service_name: serviceName,
      venue_name: (venue?.name as string | undefined) ?? 'That venue',
      collective_sync: collectiveSync,
    },
  };
}

/** Requests to this venue in this collective (or in any, without `collectiveId`), newest first. */
async function requestRows(admin: SupabaseClient, opts: { venueId?: string; collectiveId?: string; since: string }) {
  let query = admin
    .from('collective_audit_events')
    .select('collective_id, item_id, service_id, target_venue_id, created_at')
    .eq('event_type', 'adoption_requested')
    .gte('created_at', opts.since);
  if (opts.venueId) query = query.eq('target_venue_id', opts.venueId);
  if (opts.collectiveId) query = query.eq('collective_id', opts.collectiveId);
  const { data } = await query.order('created_at', { ascending: false }).limit(200);
  // The latest request per offering and venue is the one that can still be open.
  const seen = new Set<string>();
  return ((data ?? []) as Row[]).filter((r) => {
    const key = `${r.item_id as string}:${r.target_venue_id as string}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return Boolean(r.item_id && r.target_venue_id && r.service_id);
  });
}

async function isPending(admin: SupabaseClient, itemId: string, venueId: string): Promise<string | null> {
  const { data, error } = await admin.rpc('collective_adoption_pending', { p_item_id: itemId, p_venue_id: venueId });
  if (error) throw new Error(error.message);
  return typeof data === 'string' ? data : null;
}

export async function loadPendingAdoptions(
  admin: SupabaseClient,
  collectiveId: string,
  venueId: string,
  opts: { now?: () => number } = {},
): Promise<PendingAdoption[]> {
  const now = (opts.now ?? Date.now)();
  const rows = await requestRows(admin, {
    venueId,
    collectiveId,
    since: new Date(now - LOOKBACK_MS).toISOString(),
  });
  const pending: PendingAdoption[] = [];
  for (const row of rows) {
    const serviceId = await isPending(admin, row.item_id as string, venueId);
    if (!serviceId) continue;
    pending.push({
      item_id: row.item_id as string,
      service_id: serviceId,
      service_name: '',
      requested_at: row.created_at as string,
    });
  }
  if (pending.length > 0) {
    const { data: names } = await admin
      .from('service_items')
      .select('id, name')
      .in('id', pending.map((p) => p.service_id));
    for (const p of pending) {
      p.service_name = ((names ?? []).find((n) => n.id === p.service_id)?.name as string | undefined) ?? 'Your service';
    }
  }
  return pending;
}

export async function loadAdoptionReview(
  admin: SupabaseClient,
  collectiveId: string,
  itemId: string,
  venueId: string,
): Promise<AdoptionReview | null> {
  const serviceId = await isPending(admin, itemId, venueId);
  if (!serviceId) return null;
  const [{ data: item }, { data: collective }, { data: service }] = await Promise.all([
    admin.from('collective_service_items').select('id, collective_id, master_service_id').eq('id', itemId).maybeSingle(),
    admin.from('venue_collectives').select('name, host_venue_id').eq('id', collectiveId).maybeSingle(),
    admin.from('service_items').select('id, name').eq('id', serviceId).maybeSingle(),
  ]);
  if (!item || item.collective_id !== collectiveId || !item.master_service_id || !collective || !service) return null;
  const [{ data: host }, { data: variants }] = await Promise.all([
    admin.from('venues').select('name').eq('id', collective.host_venue_id as string).maybeSingle(),
    admin
      .from('service_variants')
      .select('id, name, service_item_id, is_active, sort_order')
      .in('service_item_id', [serviceId, item.master_service_id as string])
      .order('sort_order'),
  ]);
  const optionsOf = (id: string) =>
    ((variants ?? []) as Row[])
      .filter((v) => v.service_item_id === id && v.is_active !== false)
      .map((v) => ({ id: v.id as string, name: (v.name as string) ?? 'Option' }));
  const mine = optionsOf(serviceId);
  const theirs = optionsOf(item.master_service_id as string);
  const taken = new Set<string>();
  const suggested = mine.map((option) => {
    const match = theirs.find((h) => !taken.has(h.id) && sameName(h.name) === sameName(option.name));
    if (match) taken.add(match.id);
    return { my_variant_id: option.id, host_variant_id: match?.id ?? null };
  });
  return {
    item_id: itemId,
    collective_name: (collective.name as string) ?? 'your collective',
    host_name: (host?.name as string | undefined) ?? 'The host',
    service: { id: serviceId, name: (service.name as string) ?? 'Your service', options: mine },
    host_options: theirs,
    suggested_map: suggested,
  };
}

export async function runAnswerAdoption(
  ctx: AdoptionContext,
  itemId: string,
  answer: {
    choice: 'use_mine' | 'keep_separate';
    option_map?: { my_variant_id: string; host_variant_id: string | null }[];
  },
): Promise<{ ok: true; collective_sync: CollectiveSync } | { ok: false; response: NextResponse }> {
  const { data, error } = await ctx.admin.rpc('collective_answer_adoption', {
    p_collective_id: ctx.collectiveId,
    p_item_id: itemId,
    p_venue_id: ctx.venueId,
    p_choice: answer.choice,
    p_option_map: answer.choice === 'use_mine' ? (answer.option_map ?? []) : [],
    p_actor_venue_id: ctx.venueId,
    p_actor_user_id: ctx.userId,
  });
  if (error) {
    return {
      ok: false,
      response: engineErrorResponse(
        error,
        { collective: ctx.collectiveName, host: ctx.hostVenueName },
        'Could not save your answer. Please try again.',
      ),
    };
  }
  const linkId = (data as { link_id?: string } | null)?.link_id;
  const collectiveSync = await applyLinksInline(ctx.admin, linkId ? [linkId] : [], {
    actorVenueId: ctx.venueId,
    actorUserId: ctx.userId,
  });
  return { ok: true, collective_sync: collectiveSync };
}

export interface AdoptionDeadlineOutcome {
  reminded: number;
  defaulted: number;
  errors: number;
}

/** Day 7: remind the member (N26 again). Day 14: "Keep mine separate", as the system. */
export async function runAdoptionDeadlines(
  admin: SupabaseClient,
  opts: { now?: () => number } = {},
): Promise<AdoptionDeadlineOutcome> {
  const now = (opts.now ?? Date.now)();
  const outcome: AdoptionDeadlineOutcome = { reminded: 0, defaulted: 0, errors: 0 };
  const rows = await requestRows(admin, { since: new Date(now - LOOKBACK_MS).toISOString() });
  for (const row of rows) {
    const age = now - Date.parse(row.created_at as string);
    if (age < ADOPTION_REMIND_AFTER_MS) continue;
    const itemId = row.item_id as string;
    const venueId = row.target_venue_id as string;
    const collectiveId = row.collective_id as string;
    try {
      const serviceId = await isPending(admin, itemId, venueId);
      if (!serviceId) continue;
      if (age >= ADOPTION_DEFAULT_AFTER_MS) {
        const { error } = await admin.rpc('collective_answer_adoption', {
          p_collective_id: collectiveId,
          p_item_id: itemId,
          p_venue_id: venueId,
          p_choice: 'keep_separate',
          p_option_map: [],
          p_actor_venue_id: null,
          p_actor_user_id: null,
        });
        if (error) throw new Error(error.message);
        outcome.defaulted += 1;
        continue;
      }
      // One reminder per request: the key names the request's own time.
      const { data: queued, error } = await admin.from('collective_operations').upsert(
        {
          collective_id: collectiveId,
          venue_id: venueId,
          kind: 'notice',
          idempotency_key: `adopt-remind:${itemId}:${venueId}:${Date.parse(row.created_at as string)}`,
          progress: { notice: 'N26', item_id: itemId, source_service_id: serviceId, reminder: true },
        },
        { onConflict: 'idempotency_key', ignoreDuplicates: true },
      ).select('id');
      if (error) throw new Error(error.message);
      // A reminder already queued comes back empty.
      if (Array.isArray(queued) && queued.length > 0) outcome.reminded += 1;
    } catch (err) {
      outcome.errors += 1;
      console.error('[collective] adoption deadline failed:', itemId, venueId, err instanceof Error ? err.message : err);
    }
  }
  return outcome;
}

// ---------------------------------------------------------------------------
// Same-named services (Docs/link-and-collective-setup-wizard-plan.md, L13)
// ---------------------------------------------------------------------------

/**
 * The offerings each member has still to answer about, keyed by venue: an `adoption_requested`
 * with no `adoption_answered` after it. One read for the whole collective, so the host's calendar
 * groups and the setup wizard can say "waiting for {venue} to decide" without an RPC per cell.
 */
export async function loadPendingAdoptionsByVenue(admin: SupabaseClient, collectiveId: string): Promise<Map<string, Set<string>>> {
  const since = new Date(Date.now() - LOOKBACK_MS).toISOString();
  const { data } = await admin
    .from('collective_audit_events')
    .select('event_type, item_id, target_venue_id, created_at')
    .eq('collective_id', collectiveId)
    .in('event_type', ['adoption_requested', 'adoption_answered'])
    .gte('created_at', since)
    .order('created_at', { ascending: true });
  // Replayed in order: a request opens the question, an answer closes it.
  const open = new Map<string, Set<string>>();
  for (const row of (data ?? []) as Row[]) {
    const venueId = row.target_venue_id as string | null;
    const itemId = row.item_id as string | null;
    if (!venueId || !itemId) continue;
    const set = open.get(venueId) ?? new Set<string>();
    if (row.event_type === 'adoption_requested') set.add(itemId);
    else set.delete(itemId);
    open.set(venueId, set);
  }
  return open;
}

export interface SameNameMatch {
  venue_id: string;
  venue_name: string;
  service_id: string;
}

/**
 * For each of the host's active services, the members that hold an own, active service with the
 * same name (trimmed, case-insensitive) that follows no offering yet: the venues the engine will ask
 * when the host puts that service on the page. Keyed by the host's service id.
 */
export async function loadSameNameMatches(
  admin: SupabaseClient,
  collectiveId: string,
  hostVenueId: string,
): Promise<Record<string, SameNameMatch[]>> {
  const { data: members } = await admin
    .from('venue_collective_members')
    .select('venue_id, venues!venue_id (name)')
    .eq('collective_id', collectiveId)
    .eq('status', 'active')
    .neq('venue_id', hostVenueId);
  const memberNames = new Map<string, string>();
  for (const row of (members ?? []) as Row[]) {
    const joined = row.venues as { name?: string } | { name?: string }[] | null;
    memberNames.set(row.venue_id as string, (Array.isArray(joined) ? joined[0]?.name : joined?.name) ?? 'Venue');
  }
  if (memberNames.size === 0) return {};
  const [{ data: hostServices }, { data: memberServices }, { data: replicas }] = await Promise.all([
    admin.from('service_items').select('id, name').eq('venue_id', hostVenueId).eq('is_active', true),
    admin.from('service_items').select('id, name, venue_id').in('venue_id', [...memberNames.keys()]).eq('is_active', true),
    admin.from('collective_service_replicas').select('replica_service_id').in('venue_id', [...memberNames.keys()]).is('released_at', null),
  ]);
  const following = new Set(((replicas ?? []) as Row[]).map((r) => r.replica_service_id as string | null).filter(Boolean));
  const out: Record<string, SameNameMatch[]> = {};
  for (const host of (hostServices ?? []) as Row[]) {
    const wanted = sameName(host.name as string);
    const matches: SameNameMatch[] = [];
    for (const mine of (memberServices ?? []) as Row[]) {
      if (following.has(mine.id as string)) continue;
      if (sameName(mine.name as string) !== wanted) continue;
      const venueId = mine.venue_id as string;
      if (matches.some((m) => m.venue_id === venueId)) continue;
      matches.push({ venue_id: venueId, venue_name: memberNames.get(venueId) ?? 'Venue', service_id: mine.id as string });
    }
    if (matches.length > 0) out[host.id as string] = matches;
  }
  return out;
}
