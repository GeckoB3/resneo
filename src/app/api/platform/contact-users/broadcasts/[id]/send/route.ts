import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { isPlatformAuthFailure, requirePlatformSuperuserAuth } from '@/lib/platform-api-auth';
import { recordPlatformAuditEvent } from '@/lib/platform/audit';
import { BROADCAST_UUID_RE, draftToColumns, parseDraftPayload } from '@/lib/platform/broadcast-draft';
import { broadcastSendProblems, normaliseBroadcastContent } from '@/lib/platform/broadcast-email';
import {
  buildBroadcastRecipients,
  loadBroadcastAudience,
  parseAudienceSelection,
  selectAudienceVenues,
} from '@/lib/platform/broadcast-audience';
import {
  BROADCAST_COLUMNS,
  STALE_SENDING_MS,
  deliverBroadcast,
  insertBroadcastRecipients,
  type BroadcastRow,
} from '@/lib/platform/broadcast-send';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Leave headroom under maxDuration to settle counts and answer; the rest resumes from history. */
const SEND_BUDGET_MS = 240_000;

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/platform/contact-users/broadcasts/[id]/send
 *
 * First send (the email is a draft): saves any fields posted with it, works out the recipients
 * again on the server (the browser's list is never trusted), checks the count matches what the
 * superuser confirmed, claims the draft so a second click or tab cannot send it twice, records one
 * pending row per address, then delivers.
 *
 * `{ "resume": true }` on an interrupted or partly failed email sends whatever is still pending and
 * retries the failures. Addresses already sent to are never sent again.
 */
export async function POST(request: Request, { params }: Ctx) {
  const startedAt = Date.now();
  const auth = await requirePlatformSuperuserAuth();
  if (isPlatformAuthFailure(auth)) return auth;
  const { id } = await params;
  if (!BROADCAST_UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id.' }, { status: 400 });

  const json = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const resume = json?.resume === true;
  const expectedCount = typeof json?.expected_recipient_count === 'number' ? json.expected_recipient_count : null;
  const draft = parseDraftPayload(json?.draft ?? {});
  if (!draft) return NextResponse.json({ error: 'Invalid email.' }, { status: 400 });

  const admin = getSupabaseAdminClient();
  const load = async () => {
    const { data, error } = await admin.from('platform_broadcasts').select(BROADCAST_COLUMNS).eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    return data as BroadcastRow | null;
  };

  try {
    let row = await load();
    if (!row) return NextResponse.json({ error: 'Email not found.' }, { status: 404 });

    if (row.status === 'draft') {
      const cols = draftToColumns(draft);
      if (Object.keys(cols).length > 0) {
        await admin
          .from('platform_broadcasts')
          .update({ ...cols, updated_at: new Date().toISOString() })
          .eq('id', id)
          .eq('status', 'draft');
        row = (await load()) ?? row;
      }

      const content = normaliseBroadcastContent(row.content);
      const problems = broadcastSendProblems(row.subject, content);
      if (problems.length > 0) return NextResponse.json({ error: problems.join(' ') }, { status: 400 });

      const audience = await loadBroadcastAudience(admin);
      const venues = selectAudienceVenues(audience, parseAudienceSelection(row.audience));
      const recipients = buildBroadcastRecipients(venues);
      const sendable = row.important ? recipients.length : recipients.filter((r) => !r.optedOut).length;
      if (sendable === 0) {
        return NextResponse.json(
          { error: 'None of the chosen venues has an address this email can go to.' },
          { status: 400 },
        );
      }
      if (expectedCount !== null && expectedCount !== sendable) {
        return NextResponse.json(
          {
            error: `The recipient list changed while you were reviewing it: this email would now go to ${sendable} ${sendable === 1 ? 'person' : 'people'}, not ${expectedCount}. Check the list and send again.`,
            recipient_count: sendable,
          },
          { status: 409 },
        );
      }

      const nowIso = new Date().toISOString();
      const { data: claimed, error: claimErr } = await admin
        .from('platform_broadcasts')
        .update({
          status: 'sending',
          send_started_at: nowIso,
          sent_by_email: auth.user.email ?? null,
          recipient_count: recipients.length,
          updated_at: nowIso,
        })
        .eq('id', id)
        .eq('status', 'draft')
        .select(BROADCAST_COLUMNS)
        .maybeSingle();
      if (claimErr) throw new Error(claimErr.message);
      if (!claimed) return NextResponse.json({ error: 'This email is already being sent.' }, { status: 409 });
      row = claimed as BroadcastRow;

      try {
        await insertBroadcastRecipients(admin, id, recipients, row.important);
      } catch (e) {
        // Nothing has been sent yet: put the draft back so it can be sent again cleanly.
        await admin.from('platform_broadcast_recipients').delete().eq('broadcast_id', id);
        await admin.from('platform_broadcasts').update({ status: 'draft', send_started_at: null }).eq('id', id);
        throw e;
      }

      await recordPlatformAuditEvent(admin, {
        superuser: auth.user,
        action: 'broadcast.send',
        targetType: 'platform_broadcast',
        targetId: id,
        summary: `Sent "${row.subject}" to ${sendable} account ${sendable === 1 ? 'holder' : 'holders'}${row.important ? ' (important notice)' : ''}`,
        metadata: { recipients: recipients.length, sendable, important: row.important, audience: row.audience },
      });
    } else if (resume) {
      if (row.status === 'sent') {
        return NextResponse.json({ error: 'Everyone on this email has already been sent it.' }, { status: 409 });
      }
      if (row.status === 'sending') {
        const last = row.send_started_at ? Date.parse(row.send_started_at) : 0;
        if (Date.now() - last < STALE_SENDING_MS) {
          return NextResponse.json({ error: 'This email is still sending. Give it a few minutes.' }, { status: 409 });
        }
      }
      let claim = admin
        .from('platform_broadcasts')
        .update({ status: 'sending', send_started_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('status', row.status);
      if (row.status === 'sending' && row.send_started_at) claim = claim.eq('send_started_at', row.send_started_at);
      const { data: claimed, error: claimErr } = await claim.select(BROADCAST_COLUMNS).maybeSingle();
      if (claimErr) throw new Error(claimErr.message);
      if (!claimed) return NextResponse.json({ error: 'This email is already being sent.' }, { status: 409 });
      row = claimed as BroadcastRow;

      await recordPlatformAuditEvent(admin, {
        superuser: auth.user,
        action: 'broadcast.resume',
        targetType: 'platform_broadcast',
        targetId: id,
        summary: `Resumed sending "${row.subject}"`,
      });
    } else {
      return NextResponse.json({ error: 'This email has already been sent.' }, { status: 409 });
    }

    const result = await deliverBroadcast(admin, row, {
      deadlineMs: startedAt + SEND_BUDGET_MS,
      includeFailed: resume,
    });
    return NextResponse.json({ result, broadcast: await load() });
  } catch (e) {
    console.error('[platform/contact-users/send]', e, { id });
    return NextResponse.json(
      { error: 'Sending stopped because of an error. Open the email under Sent and drafts to resume.' },
      { status: 500 },
    );
  }
}
