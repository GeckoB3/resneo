import type { SupabaseClient } from '@supabase/supabase-js';
import { sendEmail } from '@/lib/emails/send-email';
import { normalizePublicBaseUrl } from '@/lib/public-base-url';
import {
  normaliseBroadcastContent,
  renderBroadcastEmail,
  type BroadcastContent,
} from '@/lib/platform/broadcast-email';
import type { BroadcastRecipient } from '@/lib/platform/broadcast-audience';
import {
  createBroadcastOneClickUnsubscribeUrl,
  createBroadcastUnsubscribePageUrl,
} from '@/lib/platform/broadcast-unsubscribe';

/** Relationship-led sender, the same one the welcome email uses; replies reach the team. */
export const BROADCAST_FROM_EMAIL = 'hello@resneo.com';
export const BROADCAST_FROM_NAME = 'ResNeo';

export type BroadcastStatus = 'draft' | 'sending' | 'sent' | 'partially_sent' | 'failed';

export interface BroadcastRow {
  id: string;
  status: BroadcastStatus;
  subject: string;
  content: unknown;
  important: boolean;
  audience: unknown;
  created_by_email: string | null;
  sent_by_email: string | null;
  created_at: string;
  updated_at: string;
  send_started_at: string | null;
  sent_at: string | null;
  recipient_count: number;
  sent_count: number;
  failed_count: number;
  skipped_count: number;
}

export const BROADCAST_COLUMNS =
  'id, status, subject, content, important, audience, created_by_email, sent_by_email, created_at, updated_at, send_started_at, sent_at, recipient_count, sent_count, failed_count, skipped_count';

/** A send that has not touched its row for this long is treated as interrupted and may resume. */
export const STALE_SENDING_MS = 5 * 60 * 1000;

const CONCURRENCY = 6;
const INSERT_CHUNK = 500;

/**
 * Writes one row per recipient before anything is sent. Opted-out addresses are recorded as
 * skipped (unless the email is an important notice) so the history shows who did not get it.
 */
export async function insertBroadcastRecipients(
  admin: SupabaseClient,
  broadcastId: string,
  recipients: BroadcastRecipient[],
  important: boolean,
): Promise<void> {
  for (let i = 0; i < recipients.length; i += INSERT_CHUNK) {
    const chunk = recipients.slice(i, i + INSERT_CHUNK).map((r) => ({
      broadcast_id: broadcastId,
      email: r.email,
      first_name: r.firstName,
      venue_ids: r.venueIds,
      venue_names: r.venueNames,
      status: !important && r.optedOut ? 'skipped_opted_out' : 'pending',
    }));
    const { error } = await admin
      .from('platform_broadcast_recipients')
      .upsert(chunk, { onConflict: 'broadcast_id,email', ignoreDuplicates: true });
    if (error) throw new Error(`Could not record recipients: ${error.message}`);
  }
}

interface RecipientRow {
  id: string;
  email: string;
  first_name: string | null;
  venue_names: string[] | null;
}

export interface BroadcastCounts {
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  pending: number;
}

export async function countBroadcastRecipients(admin: SupabaseClient, broadcastId: string): Promise<BroadcastCounts> {
  const count = async (status: string) => {
    const { count: n, error } = await admin
      .from('platform_broadcast_recipients')
      .select('id', { count: 'exact', head: true })
      .eq('broadcast_id', broadcastId)
      .eq('status', status);
    if (error) throw new Error(error.message);
    return n ?? 0;
  };
  const [sent, failed, skipped, pending] = await Promise.all([
    count('sent'),
    count('failed'),
    count('skipped_opted_out'),
    count('pending'),
  ]);
  return { total: sent + failed + skipped + pending, sent, failed, skipped, pending };
}

async function writeProgress(admin: SupabaseClient, broadcastId: string): Promise<BroadcastCounts> {
  const c = await countBroadcastRecipients(admin, broadcastId);
  await admin
    .from('platform_broadcasts')
    .update({
      recipient_count: c.total,
      sent_count: c.sent,
      failed_count: c.failed,
      skipped_count: c.skipped,
      // Keeps the claim fresh so a long send is not mistaken for an interrupted one.
      send_started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', broadcastId);
  return c;
}

function finalStatus(c: BroadcastCounts): BroadcastStatus {
  if (c.pending === 0 && c.failed === 0) return 'sent';
  return c.sent > 0 ? 'partially_sent' : 'failed';
}

/**
 * Sends every pending (and, on a retry, failed) recipient of a claimed broadcast, then settles
 * the broadcast's status and counts. Stops early at `deadlineMs` so the request can return before
 * the platform kills it; whatever is still pending can be resumed from the history tab.
 */
export async function deliverBroadcast(
  admin: SupabaseClient,
  broadcast: Pick<BroadcastRow, 'id' | 'subject' | 'content' | 'important'>,
  opts: { deadlineMs: number; includeFailed: boolean },
): Promise<BroadcastCounts & { status: BroadcastStatus; stoppedEarly: boolean }> {
  const baseUrl = normalizePublicBaseUrl(process.env.NEXT_PUBLIC_BASE_URL);
  const content: BroadcastContent = normaliseBroadcastContent(broadcast.content);
  const statuses = opts.includeFailed ? ['pending', 'failed'] : ['pending'];

  const queue: RecipientRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from('platform_broadcast_recipients')
      .select('id, email, first_name, venue_names')
      .eq('broadcast_id', broadcast.id)
      .in('status', statuses)
      .order('email')
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    queue.push(...((data ?? []) as RecipientRow[]));
    if (!data || data.length < 1000) break;
  }

  let stoppedEarly = false;
  let sinceProgress = 0;

  async function deliverOne(r: RecipientRow): Promise<void> {
    const unsubscribeUrl = broadcast.important ? null : createBroadcastUnsubscribePageUrl(r.id);
    const rendered = renderBroadcastEmail({
      baseUrl,
      subject: broadcast.subject,
      content,
      recipient: { firstName: r.first_name, venueNames: r.venue_names ?? [] },
      important: broadcast.important,
      unsubscribeUrl,
    });
    try {
      const messageId = await sendEmail({
        to: r.email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        fromEmail: BROADCAST_FROM_EMAIL,
        fromDisplayName: BROADCAST_FROM_NAME,
        replyTo: BROADCAST_FROM_EMAIL,
        categories: ['platform-broadcast'],
        headers: broadcast.important
          ? undefined
          : {
              'List-Unsubscribe': `<${createBroadcastOneClickUnsubscribeUrl(r.id)}>, <mailto:${BROADCAST_FROM_EMAIL}?subject=Unsubscribe>`,
              'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
            },
      });
      if (!messageId && !process.env.SENDGRID_API_KEY) {
        throw new Error('Email sending is not configured (SENDGRID_API_KEY is not set).');
      }
      await admin
        .from('platform_broadcast_recipients')
        .update({ status: 'sent', provider_message_id: messageId, error: null, sent_at: new Date().toISOString() })
        .eq('id', r.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await admin
        .from('platform_broadcast_recipients')
        .update({ status: 'failed', error: message.slice(0, 500) })
        .eq('id', r.id);
    }
    sinceProgress += 1;
    if (sinceProgress >= 20) {
      sinceProgress = 0;
      await writeProgress(admin, broadcast.id);
    }
  }

  let next = 0;
  async function worker(): Promise<void> {
    while (next < queue.length) {
      if (Date.now() >= opts.deadlineMs) {
        stoppedEarly = true;
        return;
      }
      const r = queue[next++];
      await deliverOne(r);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () => worker()));

  const counts = await countBroadcastRecipients(admin, broadcast.id);
  const status = finalStatus(counts);
  const nowIso = new Date().toISOString();
  await admin
    .from('platform_broadcasts')
    .update({
      status,
      recipient_count: counts.total,
      sent_count: counts.sent,
      failed_count: counts.failed,
      skipped_count: counts.skipped,
      updated_at: nowIso,
    })
    .eq('id', broadcast.id);
  if (counts.sent > 0) {
    // First delivery time; a later resume or retry does not move it.
    await admin.from('platform_broadcasts').update({ sent_at: nowIso }).eq('id', broadcast.id).is('sent_at', null);
  }

  return { ...counts, status, stoppedEarly };
}
