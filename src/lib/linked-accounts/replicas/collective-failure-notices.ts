/**
 * Telling the host and the member when an update will not go through (UX spec §4 N5; plan §6.16).
 *
 * A link that has failed three times, or has been behind for 15 minutes, is an incident: guests
 * cannot book that service on that member's calendars until it clears. The host is emailed and
 * rung, because it can act (Retry, or fix what the reason names); the member is rung, because it
 * cannot, but its calendars are the ones affected. Each venue hears once per incident and again
 * each day the incident is still open, never once per five-minute cron run.
 *
 * Runs after the replicate cron has had its go, so a link that the run itself fixed is not
 * reported.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { notifyVenue } from '@/lib/linked-accounts/notifications';
import { collectiveCopy } from '@/lib/linked-accounts/collective-copy';
import { joinNames, recordBell } from '@/lib/linked-accounts/replicas/collective-notices';
import { syncFailureReason } from '@/lib/linked-accounts/replicas/sync-reasons';

/** Failures before an incident is reported, and how long behind counts as stuck (N5). */
export const FAILED_ATTEMPTS_THRESHOLD = 3;
export const STUCK_AFTER_MS = 15 * 60 * 1000;
/** An open incident is reported again once a day. */
export const RENOTIFY_AFTER_MS = 24 * 60 * 60 * 1000;

export interface StuckLinkRow {
  id: string;
  collective_id: string;
  collective_service_item_id: string;
  venue_id: string;
  behind_since: string | null;
  attempts: number;
  last_error_code: string | null;
  failure_notified_at: string | null;
}

/**
 * True when this link is an incident the venues should hear about now: it is failing or stuck, and
 * they have not been told about this incident today.
 */
export function failureNoticeDue(link: StuckLinkRow, now: number): boolean {
  const behindSince = link.behind_since ? Date.parse(link.behind_since) : null;
  const failing = link.attempts >= FAILED_ATTEMPTS_THRESHOLD;
  const stuck = behindSince !== null && now - behindSince >= STUCK_AFTER_MS;
  if (!failing && !stuck) return false;
  if (!link.failure_notified_at) return true;
  const told = Date.parse(link.failure_notified_at);
  // Told about an earlier incident: this one is new.
  if (behindSince !== null && told < behindSince) return true;
  return now - told >= RENOTIFY_AFTER_MS;
}

export interface FailureNoticeOutcome {
  links: number;
  hostNotices: number;
  memberNotices: number;
}

/** Find the incidents that are due, tell each venue once, and record that they were told. */
export async function notifyFailingLinks(
  admin: SupabaseClient,
  opts: { now?: () => number } = {},
): Promise<FailureNoticeOutcome> {
  const now = (opts.now ?? Date.now)();
  const stuckBefore = new Date(now - STUCK_AFTER_MS).toISOString();
  const { data, error } = await admin
    .from('collective_service_replicas')
    .select(
      'id, collective_id, collective_service_item_id, venue_id, behind_since, attempts, last_error_code, failure_notified_at, applied_revision, desired_revision',
    )
    .is('released_at', null)
    .or(`attempts.gte.${FAILED_ATTEMPTS_THRESHOLD},behind_since.lte.${stuckBefore}`)
    .limit(500);
  if (error) {
    console.error('[collective] failure notices could not read the links:', error.message);
    return { links: 0, hostNotices: 0, memberNotices: 0 };
  }

  const due = ((data ?? []) as (StuckLinkRow & { applied_revision: number; desired_revision: number })[])
    // A link that caught up since it failed is not an incident any more.
    .filter((link) => Number(link.applied_revision) < Number(link.desired_revision))
    .filter((link) => failureNoticeDue(link, now));
  if (due.length === 0) return { links: 0, hostNotices: 0, memberNotices: 0 };

  const collectiveIds = [...new Set(due.map((l) => l.collective_id))];
  const itemIds = [...new Set(due.map((l) => l.collective_service_item_id))];
  const [collectivesRes, itemsRes] = await Promise.all([
    admin.from('venue_collectives').select('id, name, host_venue_id, status').in('id', collectiveIds),
    admin
      .from('collective_service_items')
      .select('id, service_items!master_service_id (name)')
      .in('id', itemIds),
  ]);
  const collectives = new Map((collectivesRes.data ?? []).map((c) => [c.id as string, c]));
  // Every venue a notice names: the members that are stuck, and the hosts that are told.
  const venueIds = [
    ...new Set([
      ...due.map((l) => l.venue_id),
      ...(collectivesRes.data ?? []).map((c) => c.host_venue_id as string),
    ]),
  ];
  const venuesRes = await admin.from('venues').select('id, name').in('id', venueIds);
  const serviceNames = new Map(
    (itemsRes.data ?? []).map((item) => {
      const joined = item.service_items as { name?: string } | { name?: string }[] | null;
      return [item.id as string, (Array.isArray(joined) ? joined[0]?.name : joined?.name) ?? 'A service'];
    }),
  );
  const venueNames = new Map((venuesRes.data ?? []).map((v) => [v.id as string, (v.name as string) ?? 'A venue']));

  // One notice per collective and member venue, naming every service stuck there.
  const incidents = new Map<string, (typeof due)[number][]>();
  for (const link of due) {
    const key = `${link.collective_id}:${link.venue_id}`;
    incidents.set(key, [...(incidents.get(key) ?? []), link]);
  }

  let hostNotices = 0;
  let memberNotices = 0;
  const told: string[] = [];
  for (const links of incidents.values()) {
    const first = links[0]!;
    const collective = collectives.get(first.collective_id);
    // A collective that has ended or paused has nobody to book, and its own notices say why.
    if (!collective || collective.status !== 'active') continue;
    const venue = venueNames.get(first.venue_id) ?? 'A venue';
    const host = venueNames.get(collective.host_venue_id as string) ?? 'the host';
    const service = joinNames(links.map((l) => serviceNames.get(l.collective_service_item_id) ?? 'A service'));
    const reason = syncFailureReason(first.last_error_code, venue);

    const hostSubject = collectiveCopy('notify.failedHost.subject', { service, venue });
    const many = links.length > 1;
    const hostBody = collectiveCopy(many ? 'notify.failedHost.bodyMany' : 'notify.failedHost.body', {
      service,
      venue,
      reason,
    });
    await notifyVenue(
      admin,
      collective.host_venue_id as string,
      hostSubject,
      {
        heading: hostSubject,
        paragraphs: [hostBody],
        ctaLabel: collectiveCopy('svc.save.retry'),
        ctaUrl: `${(process.env.NEXT_PUBLIC_BASE_URL || 'https://www.resneo.com').replace(/\/$/, '')}/dashboard/collective`,
      },
      { type: 'collective_link_failed', category: 'collective', collectiveId: first.collective_id, actorVenueId: first.venue_id },
    ).catch(() => undefined);
    hostNotices += 1;

    await recordBell(
      admin,
      first.venue_id,
      collectiveCopy(many ? 'notify.failedMember.subjectMany' : 'notify.failedMember.subject', { service, host }),
      collectiveCopy(many ? 'notify.failedMember.bodyMany' : 'notify.failedMember.body', { service, host }),
      { type: 'collective_link_failed', collectiveId: first.collective_id },
    );
    memberNotices += 1;
    told.push(...links.map((l) => l.id));
  }

  if (told.length > 0) {
    const { error: stampError } = await admin
      .from('collective_service_replicas')
      .update({ failure_notified_at: new Date(now).toISOString() })
      .in('id', told);
    if (stampError) {
      // The notices went; without the stamp they would go again next run, so say so loudly.
      console.error('[collective] failure notices sent but not recorded:', stampError.message);
    }
  }

  return { links: told.length, hostNotices, memberNotices };
}
