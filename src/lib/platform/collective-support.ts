/**
 * The platform support console's collective panel (plan §6.16; W18).
 *
 * A support person cannot open a host's Services page, so this gives them what they need to answer
 * with: every collective with its model and how up to date its venues are; for one collective, its
 * venues, its last 50 audit events and every replica link with its revisions, how long it has been
 * behind, its attempts and its last error. There is exactly one action, "Retry now" on a replica
 * link, which runs the engine's own apply, as the cron does, and is audited on both sides.
 *
 * Read-only apart from that, and never a guest's contact details: the audit rows carry service
 * values and venue names, and nothing here reads guests or bookings.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

type Row = Record<string, unknown>;

export interface SupportCollectiveRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  service_model: string;
  host_name: string;
  venue_count: number;
  invited_count: number;
  paused: boolean;
  links_behind: number;
  links_failing: number;
}

export interface SupportLinkRow {
  id: string;
  venue_name: string;
  service_name: string;
  desired_revision: number;
  applied_revision: number;
  behind_since: string | null;
  attempts: number;
  last_error_code: string | null;
  last_error: string | null;
  released: boolean;
}

export interface SupportCollectiveDetail {
  collective: SupportCollectiveRow & { paused_reason: string | null; dissolved_at: string | null };
  venues: { venue_id: string; venue_name: string; status: string; is_host: boolean; suspended: boolean; behind: number; failing: number }[];
  events: { id: string; at: string; type: string; actor: string; target: string | null; job: string | null }[];
  links: SupportLinkRow[];
}

const isFailing = (l: Row) => Boolean(l.last_error_code) && (l.attempts as number) > 0;
const isBehind = (l: Row) => (l.applied_revision as number) < (l.desired_revision as number);

async function venueNames(admin: SupabaseClient, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const { data } = await admin.from('venues').select('id, name').in('id', unique);
  return new Map(((data ?? []) as Row[]).map((v) => [v.id as string, (v.name as string) ?? 'A venue']));
}

export async function listSupportCollectives(admin: SupabaseClient): Promise<SupportCollectiveRow[]> {
  const { data: collectives, error } = await admin
    .from('venue_collectives')
    .select('id, name, slug, status, service_model, host_venue_id, paused_at')
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);
  const rows = (collectives ?? []) as Row[];
  if (rows.length === 0) return [];
  const ids = rows.map((c) => c.id as string);
  const [{ data: members }, { data: links }, names] = await Promise.all([
    admin.from('venue_collective_members').select('collective_id, status').in('collective_id', ids).in('status', ['active', 'invited']),
    admin
      .from('collective_service_replicas')
      .select('collective_id, desired_revision, applied_revision, attempts, last_error_code')
      .in('collective_id', ids)
      .is('released_at', null),
    venueNames(admin, rows.map((c) => c.host_venue_id as string)),
  ]);
  return rows.map((c) => {
    const mine = ((members ?? []) as Row[]).filter((m) => m.collective_id === c.id);
    const myLinks = ((links ?? []) as Row[]).filter((l) => l.collective_id === c.id);
    return {
      id: c.id as string,
      name: (c.name as string) ?? 'Collective',
      slug: (c.slug as string) ?? '',
      status: (c.status as string) ?? 'active',
      service_model: (c.service_model as string) ?? 'legacy_copies',
      host_name: names.get(c.host_venue_id as string) ?? 'Unknown host',
      venue_count: mine.filter((m) => m.status === 'active').length,
      invited_count: mine.filter((m) => m.status === 'invited').length,
      paused: Boolean(c.paused_at),
      links_behind: myLinks.filter(isBehind).length,
      links_failing: myLinks.filter(isFailing).length,
    };
  });
}

export async function loadSupportCollective(
  admin: SupabaseClient,
  collectiveId: string,
): Promise<SupportCollectiveDetail | null> {
  const { data: c } = await admin
    .from('venue_collectives')
    .select('id, name, slug, status, service_model, host_venue_id, paused_at, paused_reason, dissolved_at')
    .eq('id', collectiveId)
    .maybeSingle();
  if (!c) return null;
  const [{ data: members }, { data: links }, { data: events }] = await Promise.all([
    admin
      .from('venue_collective_members')
      .select('venue_id, status, suspended_at')
      .eq('collective_id', collectiveId)
      .in('status', ['active', 'invited']),
    admin
      .from('collective_service_replicas')
      .select(
        'id, venue_id, collective_service_item_id, replica_service_id, desired_revision, applied_revision, behind_since, attempts, last_error_code, last_error, released_at',
      )
      .eq('collective_id', collectiveId)
      .order('behind_since', { ascending: true, nullsFirst: false })
      .limit(500),
    admin
      .from('collective_audit_events')
      .select('id, created_at, event_type, actor_type, actor_venue_name, target_venue_name, system_job')
      .eq('collective_id', collectiveId)
      .order('created_at', { ascending: false })
      .limit(50),
  ]);
  const memberRows = (members ?? []) as Row[];
  const linkRows = (links ?? []) as Row[];
  const hostId = c.host_venue_id as string;
  const names = await venueNames(admin, [hostId, ...memberRows.map((m) => m.venue_id as string), ...linkRows.map((l) => l.venue_id as string)]);

  const itemIds = [...new Set(linkRows.map((l) => l.collective_service_item_id as string))];
  const { data: items } = itemIds.length > 0
    ? await admin.from('collective_service_items').select('id, name').in('id', itemIds)
    : { data: [] as Row[] };
  const itemName = new Map(((items ?? []) as Row[]).map((i) => [i.id as string, (i.name as string) ?? 'Service']));

  const live = linkRows.filter((l) => !l.released_at);
  const row: SupportCollectiveRow = {
    id: c.id as string,
    name: (c.name as string) ?? 'Collective',
    slug: (c.slug as string) ?? '',
    status: (c.status as string) ?? 'active',
    service_model: (c.service_model as string) ?? 'legacy_copies',
    host_name: names.get(hostId) ?? 'Unknown host',
    venue_count: memberRows.filter((m) => m.status === 'active').length,
    invited_count: memberRows.filter((m) => m.status === 'invited').length,
    paused: Boolean(c.paused_at),
    links_behind: live.filter(isBehind).length,
    links_failing: live.filter(isFailing).length,
  };
  return {
    collective: {
      ...row,
      paused_reason: (c.paused_reason as string | null) ?? null,
      dissolved_at: (c.dissolved_at as string | null) ?? null,
    },
    venues: memberRows
      .map((m) => {
        const venueId = m.venue_id as string;
        const theirs = live.filter((l) => l.venue_id === venueId);
        return {
          venue_id: venueId,
          venue_name: names.get(venueId) ?? 'A venue',
          status: m.status as string,
          is_host: venueId === hostId,
          suspended: Boolean(m.suspended_at),
          behind: theirs.filter(isBehind).length,
          failing: theirs.filter(isFailing).length,
        };
      })
      .sort((a, b) => Number(b.is_host) - Number(a.is_host) || a.venue_name.localeCompare(b.venue_name)),
    events: ((events ?? []) as Row[]).map((e) => ({
      id: e.id as string,
      at: e.created_at as string,
      type: e.event_type as string,
      actor:
        e.actor_type === 'system'
          ? 'System'
          : e.actor_type === 'support'
            ? 'Support'
            : ((e.actor_venue_name as string | null) ?? 'A venue'),
      target: (e.target_venue_name as string | null) ?? null,
      job: (e.system_job as string | null) ?? null,
    })),
    links: linkRows.map((l) => ({
      id: l.id as string,
      venue_name: names.get(l.venue_id as string) ?? 'A venue',
      service_name: itemName.get(l.collective_service_item_id as string) ?? 'Service',
      desired_revision: (l.desired_revision as number) ?? 0,
      applied_revision: (l.applied_revision as number) ?? 0,
      behind_since: (l.behind_since as string | null) ?? null,
      attempts: (l.attempts as number) ?? 0,
      last_error_code: (l.last_error_code as string | null) ?? null,
      last_error: (l.last_error as string | null) ?? null,
      released: Boolean(l.released_at),
    })),
  };
}

export type RetryOutcome =
  | { ok: true; applied: boolean; error: string | null }
  | { ok: false; status: number; error: string };

/** "Retry now": the engine's own apply, as the cron runs it, on one live link of this collective. */
export async function retrySupportLink(
  admin: SupabaseClient,
  collectiveId: string,
  linkId: string,
): Promise<RetryOutcome> {
  const { data: link } = await admin
    .from('collective_service_replicas')
    .select('id, collective_id, released_at')
    .eq('id', linkId)
    .maybeSingle();
  if (!link || link.collective_id !== collectiveId) return { ok: false, status: 404, error: 'That link is not part of this collective.' };
  if (link.released_at) return { ok: false, status: 409, error: 'That link was released, so there is nothing to retry.' };
  const { data, error } = await admin.rpc('collective_apply_replica', {
    p_link_id: linkId,
    p_actor_venue_id: null,
    p_actor_user_id: null,
    p_job: 'support-retry',
  });
  if (error) return { ok: false, status: 500, error: error.message };
  const result = (data ?? {}) as { ok?: boolean; error?: string };
  return { ok: true, applied: result.ok === true, error: result.ok === true ? null : (result.error ?? 'The apply did not complete.') };
}
