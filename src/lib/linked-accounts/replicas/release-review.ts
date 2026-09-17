/**
 * "Review your services" after a venue leaves, is removed, or its collective ends (plan contract 7;
 * UX spec J7, J8, J9 and `review.*`; W7).
 *
 * The release hands the venue its services exactly as they were (D52), so a few things are worth a
 * look: the prices and deposits the host set, online services that now need the venue's own meeting
 * link, payments that stopped because Stripe is not connected, headings, add-ons and forms that came
 * from the host, the photos being copied across, services that now share a name, and services that
 * were parked and are bookable again. Everything is read from the release's own audit row, so the
 * panel is the same whoever ended the membership and however long ago (up to 30 days), until the
 * venue dismisses it.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { sameName } from '@/lib/linked-accounts/replicas/join';

/** The panel is offered for this long after the release. */
export const REVIEW_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export interface ReleaseReview {
  collective_id: string;
  collective_name: string;
  host_name: string;
  reason: string;
  released_at: string;
  /** Services that came from the host, to check prices and deposits on. */
  prices: number;
  /** Online services that need the venue's own meeting link. */
  link: number;
  /** Payments online stopped, or will not work, until Stripe is connected. */
  stripe: boolean;
  /** Headings, add-ons and forms came from the host. */
  library: boolean;
  photos: 'copying' | 'done' | 'failed' | null;
  /** Names the venue now has two services called. */
  sameName: string[];
  /** Services that were parked and are bookable again. */
  unparked: number;
}

type Row = Record<string, unknown>;

const ids = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);

export async function loadReleaseReview(
  admin: SupabaseClient,
  venueId: string,
  opts: { now?: () => number } = {},
): Promise<ReleaseReview | null> {
  const now = (opts.now ?? Date.now)();
  const since = new Date(now - REVIEW_WINDOW_MS).toISOString();
  const { data: rows } = await admin
    .from('collective_audit_events')
    .select('id, collective_id, collective_name, created_at, changes')
    .eq('event_type', 'member_released')
    .eq('target_venue_id', venueId)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(10);
  const release = (rows ?? []).find((r) => ((r.changes as Row | null)?.after as Row | undefined)?.side === 'member');
  if (!release) return null;
  const collectiveId = release.collective_id as string;
  const releasedAt = release.created_at as string;

  const { data: mark } = await admin
    .from('collective_notice_marks')
    .select('sent_through')
    .eq('collective_id', collectiveId)
    .eq('venue_id', venueId)
    .eq('kind', 'review')
    .maybeSingle();
  if (mark?.sent_through && Date.parse(mark.sent_through as string) >= Date.parse(releasedAt)) return null;

  const after = ((release.changes as Row).after ?? {}) as Row;
  const services = ids(after.services);
  const downgraded = ids(after.downgraded);
  const unparked = ids(after.unparked);

  const [{ data: collective }, { data: venue }, { data: released }, { data: own }, { data: ops }] = await Promise.all([
    admin.from('venue_collectives').select('host_venue_id').eq('id', collectiveId).maybeSingle(),
    admin.from('venues').select('stripe_charges_enabled').eq('id', venueId).maybeSingle(),
    services.length > 0
      ? admin
          .from('service_items')
          .select('id, name, is_active, location_type, online_meeting_url, payment_requirement')
          .in('id', services)
      : Promise.resolve({ data: [] as Row[] }),
    admin.from('service_items').select('id, name').eq('venue_id', venueId).eq('is_active', true),
    admin
      .from('collective_operations')
      .select('status, created_at')
      .eq('collective_id', collectiveId)
      .eq('venue_id', venueId)
      .eq('kind', 'release_followup')
      .order('created_at', { ascending: false })
      .limit(1),
  ]);

  let hostName = 'the host';
  if (collective?.host_venue_id) {
    const { data: host } = await admin.from('venues').select('name').eq('id', collective.host_venue_id as string).maybeSingle();
    hostName = (host?.name as string | undefined) ?? hostName;
  }

  const releasedRows = (released ?? []) as Row[];
  const releasedIds = new Set(releasedRows.map((s) => s.id as string));
  const others = ((own ?? []) as Row[]).filter((s) => !releasedIds.has(s.id as string));
  const pairs = new Set<string>();
  for (const service of releasedRows) {
    if (service.is_active === false) continue;
    const twin = others.find((o) => sameName(o.name as string) === sameName(service.name as string));
    if (twin) pairs.add(service.name as string);
  }

  const paid = releasedRows.some((s) => ((s.payment_requirement as string | null) ?? 'none') !== 'none');
  const photos = await photoState(admin, venueId, collectiveId, releasedAt, (ops ?? [])[0] as Row | undefined);

  return {
    collective_id: collectiveId,
    collective_name: (release.collective_name as string) || 'your collective',
    host_name: hostName,
    reason: (after.reason as string) ?? 'left',
    released_at: releasedAt,
    prices: releasedRows.length,
    link: releasedRows.filter(
      (s) => s.is_active !== false && s.location_type === 'online' && !((s.online_meeting_url as string | null) ?? '').trim(),
    ).length,
    stripe: downgraded.length > 0 || (paid && venue?.stripe_charges_enabled !== true),
    library: releasedRows.length > 0,
    photos,
    sameName: [...pairs].sort((a, b) => a.localeCompare(b)),
    unparked: unparked.length,
  };
}

async function photoState(
  admin: SupabaseClient,
  venueId: string,
  collectiveId: string,
  releasedAt: string,
  op: Row | undefined,
): Promise<ReleaseReview['photos']> {
  if (op && (op.status === 'pending' || op.status === 'running')) return 'copying';
  const { data: events } = await admin
    .from('collective_audit_events')
    .select('event_type')
    .eq('collective_id', collectiveId)
    .eq('target_venue_id', venueId)
    .in('event_type', ['photo_copied', 'photo_copy_failed'])
    .gte('created_at', releasedAt)
    .limit(200);
  const types = new Set((events ?? []).map((e) => e.event_type as string));
  if (types.has('photo_copy_failed')) return 'failed';
  if (types.has('photo_copied')) return 'done';
  return null;
}

/** Hide the panel for this release; a later release shows it again. */
export async function dismissReleaseReview(
  admin: SupabaseClient,
  venueId: string,
  collectiveId: string,
  releasedAt: string,
): Promise<void> {
  await admin.from('collective_notice_marks').upsert(
    {
      collective_id: collectiveId,
      venue_id: venueId,
      kind: 'review',
      sent_through: releasedAt,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'collective_id,venue_id,kind' },
  );
}
