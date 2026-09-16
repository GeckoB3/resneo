/**
 * A collective's history, as its venues read it (plan Appendix E contract 3; UX spec §2 item 15
 * "Recent activity" and the History tab; W5).
 *
 * The audit log is the record a host and a member would use to settle a disagreement about who
 * changed what, so each row becomes one plain sentence naming the venue (and the person, where one
 * acted) rather than an event code. What a venue may read is decided here, once: a host sees
 * everything; a member sees what was done to it and what was done to the whole collective, never
 * what happened at another member.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { collectiveCopy } from '@/lib/linked-accounts/collective-copy';

export type HistoryFilter = 'all' | 'services' | 'calendars' | 'members';

/** Which event types each filter shows. `all` is every type, including ones not listed here. */
export const HISTORY_FILTER_TYPES: Record<Exclude<HistoryFilter, 'all'>, string[]> = {
  services: [
    'offering_added',
    'offering_withdrawn',
    'offering_reoffered',
    'master_changed',
    'master_change_undone',
    'replica_applied',
    'replica_failed',
    'unexplained_drift_repaired',
    'payment_rule_downgraded',
  ],
  calendars: ['calendar_assigned', 'calendar_unassigned', 'values_changed'],
  members: [
    'member_invited',
    'invitation_withdrawn',
    'invitation_expired',
    'member_joined',
    'member_left',
    'member_removed',
    'member_suspended',
    'member_resumed',
    'member_released',
    'host_transfer_requested',
    'host_transfer_cancelled',
    'host_transferred',
    'address_adoption_requested',
    'address_adopted',
    'address_adoption_declined',
    'collective_paused',
    'collective_resumed',
    'collective_dissolved',
  ],
};

export interface HistoryRow {
  id: string;
  created_at: string;
  event_type: string;
  collective_name: string;
  actor_type: string;
  actor_venue_id: string | null;
  actor_venue_name: string | null;
  actor_user_id: string | null;
  system_job: string | null;
  target_venue_id: string | null;
  target_venue_name: string | null;
  service_id: string | null;
  calendar_id: string | null;
  changes: Record<string, unknown> | null;
}

export interface HistoryEvent {
  id: string;
  at: string;
  type: string;
  sentence: string;
  actor: { venue_name: string | null; person: string | null };
  changes: Record<string, unknown> | null;
}

export interface HistoryNames {
  service: (id: string | null) => string;
  calendar: (id: string | null) => string;
  person: (venueId: string | null, userId: string | null) => string | null;
}

/** "Sam at Zen Studio", "Zen Studio", or "ResNeo" for the system's own work. */
export function actorWords(row: HistoryRow, names: HistoryNames): string {
  if (row.actor_type === 'system') return 'ResNeo';
  if (row.actor_type === 'support') return 'ResNeo support';
  const venue = row.actor_venue_name ?? 'A venue';
  const person = names.person(row.actor_venue_id, row.actor_user_id);
  return person ? `${person} at ${venue}` : venue;
}

/** Plain words for a master change's `changes`: the fields whose copied value differs. */
export function changedFieldWords(changes: Record<string, unknown> | null): string {
  const before = (changes?.before as { service?: Record<string, unknown> } | undefined)?.service ?? {};
  const after = (changes?.after as { service?: Record<string, unknown> } | undefined)?.service ?? {};
  const words: Record<string, string> = {
    name: 'name',
    description: 'description',
    price_pence: 'price',
    deposit_pence: 'deposit',
    payment_requirement: 'online payment',
    duration_minutes: 'length',
    buffer_minutes: 'buffer',
    cancellation_notice_hours: 'cancellation notice',
    colour: 'colour',
    is_active: 'whether it is on',
    is_bookable_online: 'staff bookings only',
  };
  const changed = Object.keys({ ...before, ...after }).filter(
    (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
  );
  const named = [...new Set(changed.map((key) => words[key] ?? 'other settings'))];
  if (named.length === 0) return 'its settings';
  if (named.length === 1) return named[0]!;
  return `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`;
}

/** One row as one sentence (UX spec `history.*`). Unknown types still read as something. */
export function historySentence(row: HistoryRow, names: HistoryNames): string {
  const actor = actorWords(row, names);
  const service = names.service(row.service_id);
  const venue = row.target_venue_name ?? 'a venue';
  const calendar = names.calendar(row.calendar_id);
  const collective = row.collective_name;
  switch (row.event_type) {
    case 'offering_added':
    case 'offering_reoffered':
      return `${actor} added ${service} to the page`;
    case 'offering_withdrawn':
      return `${actor} took ${service} off the page`;
    case 'master_changed':
      return `${actor} changed ${service}: ${changedFieldWords(row.changes)}`;
    case 'master_change_undone':
      return `${actor} put ${service} back to how it was`;
    case 'replica_applied':
      return `${service} updated at ${venue}`;
    case 'replica_failed':
      return `${service} could not be updated at ${venue}: ${String(
        (row.changes as { reason?: string } | null)?.reason ?? 'it will be retried',
      )}`;
    case 'unexplained_drift_repaired':
      return `A difference in ${service} at ${venue} was fixed`;
    case 'calendar_assigned':
      return `${actor} added ${calendar} at ${venue} to ${service}`;
    case 'calendar_unassigned':
      return `${actor} took ${calendar} at ${venue} off ${service}`;
    case 'values_changed':
      return `${actor} changed ${calendar}'s values for ${service}`;
    case 'member_invited':
      return `${actor} invited ${venue}`;
    case 'invitation_withdrawn':
      return `${actor} withdrew the invitation to ${venue}`;
    case 'invitation_expired':
      return `The invitation to ${venue} expired`;
    case 'member_joined':
      return `${venue} joined`;
    case 'member_left':
      return `${venue} left`;
    case 'member_removed':
      return `${actor} removed ${venue}`;
    case 'member_suspended':
      return `${venue}'s calendars were hidden because its subscription lapsed`;
    case 'member_resumed':
      return `${venue}'s calendars are back on the page`;
    case 'member_released':
      return `${venue}'s services became its own again`;
    case 'host_transfer_requested':
      return `${actor} asked ${venue} to host`;
    case 'host_transfer_cancelled':
      return `${actor} cancelled the move of hosting to ${venue}`;
    case 'host_transferred':
      return `${venue} became host`;
    case 'address_adoption_requested':
      return `${actor} asked to use ${venue}'s page address for ${collective}`;
    case 'address_adopted':
      return collectiveCopy('history.addressAdopted', {
        venue,
        collective,
        address: String((row.changes as { after?: { address?: string } } | null)?.after?.address ?? 'its address'),
      });
    case 'address_adoption_declined':
      return `${venue} kept its page address for now`;
    case 'collective_paused':
      return `The ${collective} page was paused`;
    case 'collective_resumed':
      return `The ${collective} page is live again`;
    case 'collective_dissolved':
      return `${actor} ended ${collective}`;
    default:
      return `${actor} made a change to ${collective}`;
  }
}

export interface HistoryQuery {
  collectiveId: string;
  /** The venue reading: a member only sees rows about itself or about the whole collective. */
  viewerVenueId: string;
  isHost: boolean;
  filter?: HistoryFilter;
  venueId?: string | null;
  from?: string | null;
  to?: string | null;
  /** `${created_at}|${id}` of the last row already shown. */
  cursor?: string | null;
  limit?: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isTimestamp = (value: string) => !Number.isNaN(Date.parse(value)) && /^[0-9T:.+\-Z ]+$/.test(value);

/**
 * `.or()` filters are strings PostgREST parses, so everything interpolated into one is checked to
 * be exactly an id or a timestamp first. Anything else is treated as absent, never passed on.
 */
function safeId(value: string | null | undefined): string | null {
  return value && UUID.test(value) ? value : null;
}

/** A page of history, newest first, with the cursor for the next page (or null at the end). */
export async function loadHistory(
  admin: SupabaseClient,
  query: HistoryQuery,
): Promise<{ events: HistoryEvent[]; next_cursor: string | null }> {
  // A page is small; an export is the only caller that asks for thousands.
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 5_000);
  let request = admin
    .from('collective_audit_events')
    .select(
      'id, created_at, event_type, collective_name, actor_type, actor_venue_id, actor_venue_name, actor_user_id, system_job, target_venue_id, target_venue_name, service_id, calendar_id, changes',
    )
    .eq('collective_id', query.collectiveId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);

  if (!query.isHost) {
    // A member reads what was done to it, and what was done to everyone.
    const viewer = safeId(query.viewerVenueId);
    if (!viewer) return { events: [], next_cursor: null };
    request = request.or(`target_venue_id.eq.${viewer},target_venue_id.is.null`);
  }
  if (query.filter && query.filter !== 'all') {
    request = request.in('event_type', HISTORY_FILTER_TYPES[query.filter]);
  }
  const venueFilter = safeId(query.venueId);
  if (venueFilter) {
    request = request.or(`target_venue_id.eq.${venueFilter},actor_venue_id.eq.${venueFilter}`);
  }
  if (query.from) request = request.gte('created_at', query.from);
  if (query.to) request = request.lte('created_at', query.to);
  if (query.cursor) {
    const [at, id] = query.cursor.split('|');
    if (at && id && isTimestamp(at) && safeId(id)) {
      request = request.or(`created_at.lt.${at},and(created_at.eq.${at},id.lt.${id})`);
    }
  }

  const { data, error } = await request;
  if (error) throw new Error(`history read failed: ${error.message}`);
  const rows = ((data ?? []) as HistoryRow[]).slice(0, limit);
  const more = (data ?? []).length > limit;
  const names = await loadHistoryNames(admin, rows);

  return {
    events: rows.map((row) => ({
      id: row.id,
      at: row.created_at,
      type: row.event_type,
      sentence: historySentence(row, names),
      actor: {
        venue_name: row.actor_type === 'venue_user' ? row.actor_venue_name : null,
        person: names.person(row.actor_venue_id, row.actor_user_id),
      },
      changes: row.changes,
    })),
    next_cursor: more && rows.length > 0 ? `${rows[rows.length - 1]!.created_at}|${rows[rows.length - 1]!.id}` : null,
  };
}

/** The service, calendar and person names a page of rows needs, in three reads, not one per row. */
async function loadHistoryNames(admin: SupabaseClient, rows: HistoryRow[]): Promise<HistoryNames> {
  const serviceIds = [...new Set(rows.map((r) => r.service_id).filter((id): id is string => Boolean(id)))];
  const calendarIds = [...new Set(rows.map((r) => r.calendar_id).filter((id): id is string => Boolean(id)))];
  const userIds = [...new Set(rows.map((r) => r.actor_user_id).filter((id): id is string => Boolean(id)))];
  const [services, calendars, staff] = await Promise.all([
    serviceIds.length > 0
      ? admin.from('service_items').select('id, name').in('id', serviceIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    calendarIds.length > 0
      ? admin.from('unified_calendars').select('id, name').in('id', calendarIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    userIds.length > 0
      ? admin.from('staff').select('user_id, venue_id, name').in('user_id', userIds)
      : Promise.resolve({ data: [] as { user_id: string; venue_id: string; name: string | null }[] }),
  ]);
  const serviceNames = new Map((services.data ?? []).map((s) => [s.id as string, s.name as string]));
  const calendarNames = new Map((calendars.data ?? []).map((c) => [c.id as string, c.name as string]));
  const people = new Map(
    (staff.data ?? [])
      .filter((s) => (s.name as string | null)?.trim())
      .map((s) => [`${s.venue_id as string}:${s.user_id as string}`, (s.name as string).trim()]),
  );
  return {
    service: (id) => (id ? serviceNames.get(id) ?? 'a service' : 'a service'),
    calendar: (id) => (id ? calendarNames.get(id) ?? 'a calendar' : 'a calendar'),
    person: (venueId, userId) => (venueId && userId ? people.get(`${venueId}:${userId}`) ?? null : null),
  };
}

/** The history as a spreadsheet a venue can keep, one row per sentence. */
export function historyCsv(events: HistoryEvent[]): string {
  const cell = (value: string | null) => {
    const text = value ?? '';
    // A cell that starts like a formula is written as text, so a spreadsheet never runs it.
    const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const lines = [['When', 'What happened', 'Venue', 'Person'].join(',')];
  for (const event of events) {
    lines.push(
      [cell(event.at), cell(event.sentence), cell(event.actor.venue_name), cell(event.actor.person)].join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}
