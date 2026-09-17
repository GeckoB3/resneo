/**
 * Sending the notices the engine queues (UX spec §4 N19 to N23; plan §6.7 "after commit"; W7).
 *
 * A lifecycle step that changes who hosts, or ends a collective, cannot email from inside its
 * database transaction, so it writes a `collective_operations` row of kind `notice` with the notice
 * id and an idempotency key. This drains those rows: it claims each one, tells the venues the
 * notice is for, and marks it done, retrying a failure a few times before giving up loudly.
 *
 *   N19  the collective ended            every venue that was live when it ended
 *   N20  asked to host                   the venue that was asked
 *   N21  the move of hosting is agreed   every live venue, with the day it happens
 *   N22  hosting moved                   every live venue
 *   N23  the page is paused              every live venue, with the day it would end
 *   N36  a member's subscription lapsed  that member
 *   N37  and came back                   that member (a bell only)
 *   N26  the host wants to use a member's service   that member, and again at day 7
 *   N25  a member suggests its own service   the host, with the way to add it
 *   N1   an invitation still open at day 7            the invitee (the first N1 is the invite route's)
 *   N34  the host withdrew an invitation              the invitee, by email
 *   N35  an invitation expired after 30 days          the invitee and the host, by bell
 *
 * A reminder (`progress.reminder`) of N20, N21 or N23 is sent only while what it reminds about still
 * stands: the same venue still asked, the same day still set, the page still paused since then.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { notifyVenue } from '@/lib/linked-accounts/notifications';
import { collectiveCopy } from '@/lib/linked-accounts/collective-copy';
import { noticeDate } from '@/lib/linked-accounts/replicas/notice-dates';
import { recordBell } from '@/lib/linked-accounts/replicas/collective-notices';

const BATCH = 50;
const MAX_ATTEMPTS = 5;
const RETRY_AFTER_MS = 5 * 60 * 1000;
/** A paused collective ends after this long (plan §6.7). */
const PAUSE_ENDS_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

interface OperationRow {
  id: string;
  collective_id: string;
  venue_id: string | null;
  attempts: number;
  progress: Record<string, unknown> | null;
}

export interface OperationNoticeOutcome {
  sent: number;
  failed: number;
}

export { noticeDate };

export async function drainOperationNotices(
  admin: SupabaseClient,
  opts: { now?: () => number } = {},
): Promise<OperationNoticeOutcome> {
  const now = (opts.now ?? Date.now)();
  const { data, error } = await admin
    .from('collective_operations')
    .select('id, collective_id, venue_id, attempts, progress')
    .eq('kind', 'notice')
    .eq('status', 'pending')
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${new Date(now).toISOString()}`)
    .order('created_at', { ascending: true })
    .limit(BATCH);
  if (error) {
    console.error('[collective] could not read queued notices:', error.message);
    return { sent: 0, failed: 0 };
  }

  let sent = 0;
  let failed = 0;
  for (const op of (data ?? []) as OperationRow[]) {
    // Claim it, so two overlapping runs never send the same notice twice.
    const { data: claimed } = await admin
      .from('collective_operations')
      .update({ status: 'running', attempts: op.attempts + 1 })
      .eq('id', op.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();
    if (!claimed) continue;

    try {
      await sendOne(admin, op, now);
      await admin
        .from('collective_operations')
        .update({ status: 'done', last_error: null, next_attempt_at: null })
        .eq('id', op.id);
      sent += 1;
    } catch (err) {
      const giveUp = op.attempts + 1 >= MAX_ATTEMPTS;
      const message = err instanceof Error ? err.message : String(err);
      console.error('[collective] a queued notice failed:', op.id, message);
      await admin
        .from('collective_operations')
        .update({
          status: giveUp ? 'failed' : 'pending',
          last_error: message.slice(0, 500),
          next_attempt_at: giveUp ? null : new Date(now + RETRY_AFTER_MS).toISOString(),
        })
        .eq('id', op.id);
      failed += 1;
    }
  }
  return { sent, failed };
}

async function sendOne(admin: SupabaseClient, op: OperationRow, now: number): Promise<void> {
  const notice = String(op.progress?.notice ?? '');
  const { data: collective } = await admin
    .from('venue_collectives')
    .select('id, name, host_venue_id, dissolved_at, paused_at, status, pending_host_venue_id, host_transfer_at, pending_adopted_venue_id')
    .eq('id', op.collective_id)
    .maybeSingle();
  if (!collective && notice === 'N19' && op.progress?.host_deleted === true) {
    // The host venue was deleted, taking the collective's rows with it: the job carries what it needs.
    const name = typeof op.progress.collective_name === 'string' ? op.progress.collective_name : 'your collective';
    const venueIds = Array.isArray(op.progress.venue_ids) ? (op.progress.venue_ids as string[]) : [];
    const subject = collectiveCopy('notify.dissolved.subject', { collective: name });
    for (const venueId of venueIds) {
      await notifyVenue(
        admin,
        venueId,
        subject,
        { heading: subject, paragraphs: [collectiveCopy('notify.dissolved.body')] },
        { type: 'collective_n19', category: 'collective', collectiveId: null },
      );
    }
    return;
  }
  if (!collective) throw new Error('collective not found');
  const collectiveName = (collective.name as string) ?? 'your collective';

  const names = async (ids: string[]) => {
    const { data } = await admin.from('venues').select('id, name').in('id', ids.length > 0 ? ids : ['00000000-0000-0000-0000-000000000000']);
    return new Map((data ?? []).map((v) => [v.id as string, (v.name as string) ?? 'A venue']));
  };
  const liveVenues = async () => {
    const { data } = await admin
      .from('venue_collective_members')
      .select('venue_id')
      .eq('collective_id', op.collective_id)
      .eq('status', 'active');
    return (data ?? []).map((m) => m.venue_id as string);
  };
  const tell = async (venueIds: string[], subject: string, body: string) => {
    for (const venueId of venueIds) {
      // The bell is recorded whatever happens to the email, and an email that fails is logged by
      // notifyVenue. Retrying the whole notice would tell every other venue twice, so it is not.
      await notifyVenue(
        admin,
        venueId,
        subject,
        { heading: subject, paragraphs: [body] },
        { type: `collective_${notice.toLowerCase()}`, category: 'collective', collectiveId: op.collective_id },
      );
    }
  };

  if (op.progress?.reminder === true && ['N20', 'N21', 'N23'].includes(notice)) {
    const sameTime = (a: unknown, b: unknown) =>
      typeof a === 'string' && typeof b === 'string' && Date.parse(a) === Date.parse(b);
    const stands =
      collective.status === 'active' &&
      (notice === 'N20'
        ? collective.pending_host_venue_id === op.venue_id && !collective.host_transfer_at
        : notice === 'N21'
          ? collective.pending_host_venue_id === op.venue_id &&
            sameTime(collective.host_transfer_at, op.progress?.host_transfer_at)
          : sameTime(collective.paused_at, op.progress?.paused_at));
    if (!stands) return;
  }

  if (notice === 'N25') {
    const fromVenueId = String(op.progress?.from_venue_id ?? '');
    const serviceId = String(op.progress?.service_id ?? '');
    const hostId = collective.host_venue_id as string;
    const [venueNames, { data: service }] = await Promise.all([
      names([fromVenueId]),
      admin.from('service_items').select('name').eq('id', serviceId).maybeSingle(),
    ]);
    const params = {
      venue: venueNames.get(fromVenueId) ?? 'A venue',
      service: (service?.name as string | undefined) ?? 'a service',
      collective: collectiveName,
    };
    const subject = collectiveCopy('notify.suggestion.subject', params);
    const base = (process.env.NEXT_PUBLIC_BASE_URL || 'https://www.resneo.com').replace(/\/$/, '');
    // The link opens "Add from another venue" with this venue and service already chosen.
    await notifyVenue(
      admin,
      hostId,
      subject,
      {
        heading: subject,
        paragraphs: [collectiveCopy('notify.suggestion.body', params)],
        ctaLabel: collectiveCopy('svc.addFrom.button'),
        ctaUrl: `${base}/dashboard/appointment-services?add_from=${encodeURIComponent(fromVenueId)}&service=${encodeURIComponent(serviceId)}`,
      },
      { type: 'collective_n25', category: 'collective', collectiveId: op.collective_id, actorVenueId: fromVenueId },
    );
    return;
  }

  if (notice === 'N1' || notice === 'N34' || notice === 'N35') {
    if (!op.venue_id) throw new Error(`${notice} without a venue`);
    const hostId = collective.host_venue_id as string;
    const venueNames = await names([hostId, op.venue_id]);
    const params = {
      host: venueNames.get(hostId) ?? 'The host',
      venue: venueNames.get(op.venue_id) ?? 'your venue',
      collective: collectiveName,
    };
    if (notice === 'N1') {
      // A reminder: only while the invitation is still open.
      const { data: still } = await admin
        .from('venue_collective_members')
        .select('id')
        .eq('collective_id', op.collective_id)
        .eq('venue_id', op.venue_id)
        .eq('status', 'invited')
        .maybeSingle();
      if (!still) return;
      const subject = collectiveCopy('notify.invite.subject', params);
      const base = (process.env.NEXT_PUBLIC_BASE_URL || 'https://www.resneo.com').replace(/\/$/, '');
      await notifyVenue(
        admin,
        op.venue_id,
        subject,
        {
          heading: subject,
          paragraphs: [collectiveCopy('notify.invite.body', params)],
          ctaLabel: collectiveCopy('notify.invite.cta'),
          ctaUrl: `${base}/dashboard/settings?tab=linked-accounts`,
        },
        { type: 'collective_n1', category: 'collective', collectiveId: op.collective_id },
      );
      return;
    }
    if (notice === 'N34') {
      const subject = collectiveCopy('notify.inviteWithdrawn.subject', params);
      // Email only (UX spec §4): the invitee has nothing to act on.
      await notifyVenue(
        admin,
        op.venue_id,
        subject,
        { heading: subject, paragraphs: [collectiveCopy('notify.inviteWithdrawn.body', params)] },
        false,
      );
      return;
    }
    const subject = collectiveCopy('notify.inviteExpired.subject', params);
    const body = collectiveCopy('notify.inviteExpired.body', params);
    for (const venueId of [op.venue_id, hostId]) {
      await recordBell(admin, venueId, subject, body, { type: 'collective_n35', collectiveId: op.collective_id });
    }
    return;
  }

  if (notice === 'N38') {
    if (!op.venue_id) throw new Error('N38 without a venue');
    // A request withdrawn or answered before the drain is not sent.
    if (collective.status !== 'active' || collective.pending_adopted_venue_id !== op.venue_id) return;
    const hostId = String(op.progress?.host_venue_id ?? collective.host_venue_id);
    const [venueNames, { data: own }] = await Promise.all([
      names([hostId]),
      admin.from('venues').select('slug').eq('id', op.venue_id).maybeSingle(),
    ]);
    const base = (process.env.NEXT_PUBLIC_BASE_URL || 'https://www.resneo.com').replace(/\/$/, '');
    const params = {
      host: venueNames.get(hostId) ?? 'The host',
      collective: collectiveName,
      ownAddress: own?.slug ? `${base}/book/${own.slug as string}` : 'your page address',
    };
    const subject = collectiveCopy('notify.adoptAddress.subject', params);
    await notifyVenue(
      admin,
      op.venue_id,
      subject,
      {
        heading: subject,
        paragraphs: [collectiveCopy('notify.adoptAddress.body', params)],
        ctaLabel: collectiveCopy('notify.adoptAddress.cta'),
        ctaUrl: `${base}/dashboard/settings?tab=booking-page`,
      },
      { type: 'collective_n38', category: 'collective', collectiveId: op.collective_id },
    );
    return;
  }

  if (notice === 'N20') {
    if (!op.venue_id) throw new Error('N20 without a venue');
    const hostId = String(op.progress?.host_venue_id ?? collective.host_venue_id);
    const venueNames = await names([hostId]);
    const host = venueNames.get(hostId) ?? 'The host';
    await tell(
      [op.venue_id],
      collectiveCopy('notify.hostRequest.subject', { host, collective: collectiveName }),
      collectiveCopy('notify.hostRequest.body', { collective: collectiveName }),
    );
    return;
  }

  if (notice === 'N21' || notice === 'N22') {
    if (!op.venue_id) throw new Error(`${notice} without a venue`);
    const venues = await liveVenues();
    const venueNames = await names([op.venue_id]);
    const newHost = venueNames.get(op.venue_id) ?? 'A venue';
    const date = noticeDate(op.progress?.host_transfer_at as string | undefined);
    const key = notice === 'N21' ? 'hostMoving' : 'hostMoved';
    await tell(
      venues,
      collectiveCopy(`notify.${key}.subject` as 'notify.hostMoving.subject', { newHost, collective: collectiveName, date }),
      collectiveCopy(`notify.${key}.body` as 'notify.hostMoving.body', { newHost, collective: collectiveName, date }),
    );
    return;
  }

  if (notice === 'N23') {
    const venues = (await liveVenues()).filter((v) => v !== op.venue_id);
    const venueNames = await names(op.venue_id ? [op.venue_id] : []);
    const oldHost = op.venue_id ? venueNames.get(op.venue_id) ?? 'The host' : 'The host';
    const pausedAt = collective.paused_at ? Date.parse(collective.paused_at as string) : now;
    const date = noticeDate(new Date(pausedAt + PAUSE_ENDS_AFTER_MS).toISOString());
    await tell(
      venues,
      collectiveCopy('notify.paused.subject', { collective: collectiveName }),
      collectiveCopy('notify.paused.body', { oldHost, collective: collectiveName, date }),
    );
    return;
  }

  if (notice === 'N26') {
    if (!op.venue_id) throw new Error('N26 without a venue');
    const itemId = String(op.progress?.item_id ?? '');
    const serviceId = String(op.progress?.source_service_id ?? '');
    // A reminder for a question already answered is not sent.
    if (op.progress?.reminder === true) {
      const { data: still } = await admin.rpc('collective_adoption_pending', { p_item_id: itemId, p_venue_id: op.venue_id });
      if (!still) return;
    }
    const [venueNames, { data: service }] = await Promise.all([
      names([collective.host_venue_id as string]),
      admin.from('service_items').select('name').eq('id', serviceId).maybeSingle(),
    ]);
    const host = venueNames.get(collective.host_venue_id as string) ?? 'The host';
    const params = { host, service: (service?.name as string | undefined) ?? 'your service', collective: collectiveName };
    const subject = collectiveCopy('notify.adopt.subject', params);
    const base = (process.env.NEXT_PUBLIC_BASE_URL || 'https://www.resneo.com').replace(/\/$/, '');
    await notifyVenue(
      admin,
      op.venue_id,
      subject,
      {
        heading: subject,
        paragraphs: [collectiveCopy('notify.adopt.body', params)],
        ctaLabel: collectiveCopy('notify.adopt.cta'),
        ctaUrl: `${base}/dashboard/appointment-services?adopt=${encodeURIComponent(itemId)}`,
      },
      { type: 'collective_n26', category: 'collective', collectiveId: op.collective_id, payload: { item_id: itemId } },
    );
    return;
  }

  if (notice === 'N36' || notice === 'N37') {
    if (!op.venue_id) throw new Error(`${notice} without a venue`);
    const venueNames = await names([op.venue_id]);
    const venue = venueNames.get(op.venue_id) ?? 'Your venue';
    const key = notice === 'N36' ? 'suspended' : 'resumed';
    const subject = collectiveCopy(`notify.${key}.subject` as 'notify.suspended.subject', { collective: collectiveName });
    const body = collectiveCopy(`notify.${key}.body` as 'notify.suspended.body', { venue, collective: collectiveName });
    if (notice === 'N36') {
      await tell([op.venue_id], subject, body);
    } else {
      // Good news that needs no action: a bell, not an email.
      await recordBell(admin, op.venue_id, subject, body, { type: 'collective_n37', collectiveId: op.collective_id });
    }
    return;
  }

  if (notice === 'N19') {
    // Everyone who was live when it ended: rows the dissolve moved to `left` in that moment.
    const endedAt = collective.dissolved_at ? Date.parse(collective.dissolved_at as string) : now;
    const { data: members } = await admin
      .from('venue_collective_members')
      .select('venue_id, left_at')
      .eq('collective_id', op.collective_id)
      .eq('status', 'left');
    const venues = (members ?? [])
      .filter((m) => m.left_at && Math.abs(Date.parse(m.left_at as string) - endedAt) < 60_000)
      .map((m) => m.venue_id as string)
      // The host ended it, and does not need telling.
      .filter((v) => v !== op.venue_id);
    await tell(
      venues,
      collectiveCopy('notify.dissolved.subject', { collective: collectiveName }),
      collectiveCopy('notify.dissolved.body'),
    );
    return;
  }

  throw new Error(`unknown notice ${notice || '(none)'}`);
}
