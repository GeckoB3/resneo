/**
 * The work after a release (plan §6.7 "The release", RT1-15; UX spec N16 to N18; W7).
 *
 * `collective_release_member` hands a venue its services in one transaction and queues one
 * `release_followup` job for what cannot happen inside it:
 *
 *   photos   each photo the venue's services showed on the collective page is copied into the
 *            venue's own storage and put on its own page, so the venue keeps it when the
 *            collective's files go. Each copy is recorded (photo_copied, photo_copy_failed); a copy
 *            that fails is retried, and after the last try the service is left without a photo and
 *            the review panel says so;
 *   notices  N16 (the venue left: the host by email, the other venues by bell), N17 (the host removed
 *            it, or it was suspended too long: the venue), N18 (a link ended: the venue and the
 *            host). A collective that ended sends N19 from its own job, so nothing is sent here.
 *
 * Each step records its progress on the job, so a retry repeats neither a copy nor a notice.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { collectiveCopy } from '@/lib/linked-accounts/collective-copy';
import { notifyVenue } from '@/lib/linked-accounts/notifications';
import { recordBell } from '@/lib/linked-accounts/replicas/collective-notices';
import { venueStorageObjectPathFromPublicUrl } from '@/lib/venue/venue-storage-url';

const BATCH = 25;
export const RELEASE_FOLLOWUP_MAX_ATTEMPTS = 5;
const RETRY_AFTER_MS = 5 * 60 * 1000;
const PHOTO_BUCKET = 'venue-service-photos';

type Row = Record<string, unknown>;

/** Where the review panel lives: the venue's Linked accounts settings. */
const reviewUrl = () =>
  `${(process.env.NEXT_PUBLIC_BASE_URL || 'https://www.resneo.com').replace(/\/$/, '')}/dashboard/settings?tab=linked-accounts`;

interface FollowupRow {
  id: string;
  collective_id: string;
  venue_id: string | null;
  attempts: number;
  progress: Row | null;
}

interface Progress {
  reason?: string;
  services?: string[];
  /** Services whose photo step is finished, copied or not. */
  photos_done?: string[];
  notified?: boolean;
}

export interface ReleaseFollowupOutcome {
  done: number;
  retrying: number;
  failed: number;
  photos_copied: number;
  photos_failed: number;
}

export async function drainReleaseFollowups(
  admin: SupabaseClient,
  opts: { now?: () => number; operationIds?: string[] } = {},
): Promise<ReleaseFollowupOutcome> {
  const now = (opts.now ?? Date.now)();
  const outcome: ReleaseFollowupOutcome = { done: 0, retrying: 0, failed: 0, photos_copied: 0, photos_failed: 0 };
  if (opts.operationIds && opts.operationIds.length === 0) return outcome;
  let query = admin
    .from('collective_operations')
    .select('id, collective_id, venue_id, attempts, progress')
    .eq('kind', 'release_followup')
    .eq('status', 'pending');
  if (opts.operationIds) {
    query = query.in('id', opts.operationIds);
  } else {
    query = query.or(`next_attempt_at.is.null,next_attempt_at.lte.${new Date(now).toISOString()}`);
  }
  const { data, error } = await query.order('created_at', { ascending: true }).limit(BATCH);
  if (error) {
    console.error('[collective] could not read release follow-ups:', error.message);
    return outcome;
  }

  for (const op of (data ?? []) as FollowupRow[]) {
    const { data: claimed } = await admin
      .from('collective_operations')
      .update({ status: 'running', attempts: op.attempts + 1 })
      .eq('id', op.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();
    if (!claimed) continue;

    const attempt = op.attempts + 1;
    const lastTry = attempt >= RELEASE_FOLLOWUP_MAX_ATTEMPTS;
    const progress: Progress = { ...((op.progress ?? {}) as Progress) };
    try {
      const photos = await copyPhotos(admin, op, progress, lastTry, now);
      outcome.photos_copied += photos.copied;
      outcome.photos_failed += photos.failed;
      if (!progress.notified) {
        await sendReleaseNotice(admin, op, progress.reason ?? 'left');
        progress.notified = true;
      }
      const finished = photos.pending === 0;
      await admin
        .from('collective_operations')
        .update({
          status: finished ? 'done' : 'pending',
          progress,
          last_error: finished ? null : `${photos.pending} photos not copied yet`,
          next_attempt_at: finished ? null : new Date(now + RETRY_AFTER_MS).toISOString(),
        })
        .eq('id', op.id);
      if (finished) outcome.done += 1;
      else outcome.retrying += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[collective] a release follow-up failed:', op.id, message);
      await admin
        .from('collective_operations')
        .update({
          status: lastTry ? 'failed' : 'pending',
          progress,
          last_error: message.slice(0, 500),
          next_attempt_at: lastTry ? null : new Date(now + RETRY_AFTER_MS).toISOString(),
        })
        .eq('id', op.id);
      if (lastTry) outcome.failed += 1;
      else outcome.retrying += 1;
    }
  }
  return outcome;
}

/** The photo the collective page showed for each released service, by service id. */
async function photosToCopy(admin: SupabaseClient, op: FollowupRow, services: string[]): Promise<Map<string, string>> {
  const photos = new Map<string, string>();
  if (services.length === 0 || !op.venue_id) return photos;
  const { data: links } = await admin
    .from('collective_service_replicas')
    .select('replica_service_id, collective_service_item_id')
    .eq('collective_id', op.collective_id)
    .eq('venue_id', op.venue_id)
    .in('replica_service_id', services);
  const itemIds = [...new Set((links ?? []).map((l) => l.collective_service_item_id as string))];
  if (itemIds.length === 0) return photos;
  const { data: items } = await admin
    .from('collective_service_items')
    .select('id, image_url, master_service_id')
    .in('id', itemIds);
  const { data: collective } = await admin
    .from('venue_collectives')
    .select('host_venue_id')
    .eq('id', op.collective_id)
    .maybeSingle();
  // An offering without its own photo shows the host's photo for the service, when it has one.
  let hostPhotos: Row = {};
  if (collective?.host_venue_id && collective.host_venue_id !== op.venue_id) {
    const { data: host } = await admin
      .from('venues')
      .select('booking_page_config')
      .eq('id', collective.host_venue_id as string)
      .maybeSingle();
    hostPhotos = (((host?.booking_page_config as Row | null)?.service_photos as Row | null) ?? {}) as Row;
  }
  const byItem = new Map((items ?? []).map((i) => [i.id as string, i]));
  for (const link of links ?? []) {
    const item = byItem.get(link.collective_service_item_id as string);
    const url =
      (item?.image_url as string | null) ??
      (typeof hostPhotos[item?.master_service_id as string] === 'string'
        ? (hostPhotos[item?.master_service_id as string] as string)
        : null);
    if (url && url.trim()) photos.set(link.replica_service_id as string, url.trim());
  }
  return photos;
}

async function copyPhotos(
  admin: SupabaseClient,
  op: FollowupRow,
  progress: Progress,
  lastTry: boolean,
  now: number,
): Promise<{ copied: number; failed: number; pending: number }> {
  const done = new Set(progress.photos_done ?? []);
  const services = (progress.services ?? []).filter((id) => !done.has(id));
  const result = { copied: 0, failed: 0, pending: 0 };
  if (services.length === 0 || !op.venue_id) return result;
  const photos = await photosToCopy(admin, op, services);
  for (const id of services) if (!photos.has(id)) done.add(id);

  const placed: Record<string, string> = {};
  for (const [serviceId, url] of photos) {
    const copy = await copyObject(admin, url, op.venue_id);
    if ('url' in copy) {
      placed[serviceId] = copy.url;
      done.add(serviceId);
      result.copied += 1;
      await admin.rpc('collective_record_release_photo', {
        p_operation_id: op.id,
        p_service_id: serviceId,
        p_copied: true,
        p_detail: copy.url,
        p_now: new Date(now).toISOString(),
      });
    } else if (lastTry) {
      done.add(serviceId);
      result.failed += 1;
      await admin.rpc('collective_record_release_photo', {
        p_operation_id: op.id,
        p_service_id: serviceId,
        p_copied: false,
        p_detail: copy.error,
        p_now: new Date(now).toISOString(),
      });
    } else {
      result.pending += 1;
    }
  }

  if (Object.keys(placed).length > 0) await placeOnOwnPage(admin, op.venue_id, placed);
  progress.photos_done = [...done];
  return result;
}

/** Copy a photo into the venue's own folder; a photo held elsewhere is kept by its address. */
async function copyObject(admin: SupabaseClient, url: string, venueId: string): Promise<{ url: string } | { error: string }> {
  const from = venueStorageObjectPathFromPublicUrl(url, PHOTO_BUCKET);
  if (!from) {
    // Not one of our files (an address typed in by hand, say): there is nothing to copy.
    return /^https:\/\//i.test(url) ? { url } : { error: 'not a photo address' };
  }
  if (from.startsWith(`${venueId}/`)) return { url };
  const ext = (from.split('.').pop() ?? 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const to = `${venueId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await admin.storage.from(PHOTO_BUCKET).copy(from, to);
  if (error) return { error: error.message || 'copy failed' };
  const { data } = admin.storage.from(PHOTO_BUCKET).getPublicUrl(to);
  return { url: data.publicUrl };
}

/** Show the copies on the venue's own page, never replacing a photo the venue chose itself. */
async function placeOnOwnPage(admin: SupabaseClient, venueId: string, placed: Record<string, string>): Promise<void> {
  const { data: venue } = await admin.from('venues').select('booking_page_config').eq('id', venueId).maybeSingle();
  const config = ((venue?.booking_page_config as Row | null) ?? {}) as Row;
  const existing = ((config.service_photos as Row | null) ?? {}) as Row;
  const next: Row = { ...existing };
  for (const [serviceId, url] of Object.entries(placed)) {
    if (typeof next[serviceId] !== 'string' || !(next[serviceId] as string).trim()) next[serviceId] = url;
  }
  await admin
    .from('venues')
    .update({ booking_page_config: { ...config, service_photos: next } })
    .eq('id', venueId);
}

async function sendReleaseNotice(admin: SupabaseClient, op: FollowupRow, reason: string): Promise<void> {
  if (!op.venue_id || reason === 'dissolved') return;
  const { data: collective } = await admin
    .from('venue_collectives')
    .select('name, host_venue_id')
    .eq('id', op.collective_id)
    .maybeSingle();
  if (!collective) throw new Error('collective not found');
  const collectiveName = (collective.name as string | null) ?? 'your collective';
  const hostId = collective.host_venue_id as string;
  const { data: venues } = await admin.from('venues').select('id, name').in('id', [op.venue_id, hostId]);
  const nameOf = (id: string, fallback: string) =>
    ((venues ?? []).find((v) => v.id === id)?.name as string | undefined) ?? fallback;
  const venue = nameOf(op.venue_id, 'A venue');
  const host = nameOf(hostId, 'The host');
  const meta = { category: 'collective' as const, collectiveId: op.collective_id };

  const email = async (to: string, key: string, subject: string, body: string, cta?: string) => {
    await notifyVenue(
      admin,
      to,
      subject,
      {
        heading: subject,
        paragraphs: [body],
        ...(cta ? { ctaLabel: cta, ctaUrl: reviewUrl() } : {}),
      },
      { type: `collective_${key}`, ...meta, actorVenueId: op.venue_id },
    );
  };

  if (reason === 'left' || reason === 'venue_deleted') {
    const subject = collectiveCopy('notify.left.subject', { venue, collective: collectiveName });
    const body = collectiveCopy('notify.left.body', { venue, collective: collectiveName });
    await email(hostId, 'left', subject, body);
    const { data: others } = await admin
      .from('venue_collective_members')
      .select('venue_id')
      .eq('collective_id', op.collective_id)
      .eq('status', 'active');
    for (const other of others ?? []) {
      const id = other.venue_id as string;
      if (id === hostId || id === op.venue_id) continue;
      await recordBell(admin, id, subject, body, { type: 'collective_left', collectiveId: op.collective_id, actorVenueId: op.venue_id });
    }
    return;
  }

  if (reason === 'link_ended') {
    const subject = collectiveCopy('notify.linkEnded.subject', { venue, collective: collectiveName });
    const body = collectiveCopy('notify.linkEnded.body', { venue, host, collective: collectiveName });
    await email(op.venue_id, 'link_ended', subject, body, collectiveCopy('notify.review.cta'));
    await email(hostId, 'link_ended', subject, body);
    return;
  }

  // Removed by the host, or suspended for too long.
  const subject = collectiveCopy('notify.removed.subject', { collective: collectiveName });
  const body = collectiveCopy('notify.removed.body', { venue, host, collective: collectiveName });
  await email(op.venue_id, 'removed', subject, body, collectiveCopy('notify.review.cta'));
}
