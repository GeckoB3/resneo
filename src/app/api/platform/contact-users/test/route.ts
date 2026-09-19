import { NextResponse } from 'next/server';
import { isPlatformAuthFailure, requirePlatformSuperuserAuth } from '@/lib/platform-api-auth';
import { parseDraftPayload } from '@/lib/platform/broadcast-draft';
import { broadcastSendProblems, emptyBroadcastContent, renderBroadcastEmail } from '@/lib/platform/broadcast-email';
import { sendEmail } from '@/lib/emails/send-email';
import { normalizePublicBaseUrl } from '@/lib/public-base-url';
import { createBroadcastTestUnsubscribeUrl } from '@/lib/platform/broadcast-unsubscribe';
import { BROADCAST_FROM_EMAIL, BROADCAST_FROM_NAME } from '@/lib/platform/broadcast-send';

export const dynamic = 'force-dynamic';

/**
 * POST /api/platform/contact-users/test
 * Sends the email as composed to the signed-in superuser only, personalised with the sample name
 * and venue the preview is showing. The subject is marked [Test] and nothing is recorded.
 */
export async function POST(request: Request) {
  const auth = await requirePlatformSuperuserAuth();
  if (isPlatformAuthFailure(auth)) return auth;
  const to = auth.user.email?.trim();
  if (!to) {
    return NextResponse.json({ error: 'Your login has no email address to send the test to.' }, { status: 400 });
  }

  const json = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const draft = parseDraftPayload(json?.draft ?? {});
  if (!draft) return NextResponse.json({ error: 'Invalid email.' }, { status: 400 });

  const subject = draft.subject ?? '';
  const content = draft.content ?? emptyBroadcastContent();
  const problems = broadcastSendProblems(subject, content);
  if (problems.length > 0) return NextResponse.json({ error: problems.join(' ') }, { status: 400 });

  const sample = (json?.sample ?? {}) as { firstName?: unknown; venueName?: unknown };
  const firstName = typeof sample.firstName === 'string' ? sample.firstName.slice(0, 40) : null;
  const venueName =
    typeof sample.venueName === 'string' && sample.venueName.trim() ? sample.venueName.slice(0, 120) : 'Your venue';
  const important = draft.important === true;

  const rendered = renderBroadcastEmail({
    baseUrl: normalizePublicBaseUrl(process.env.NEXT_PUBLIC_BASE_URL),
    subject,
    content,
    recipient: { firstName, venueNames: [venueName] },
    important,
    unsubscribeUrl: important ? null : createBroadcastTestUnsubscribeUrl(),
  });

  try {
    const messageId = await sendEmail({
      to,
      subject: `[Test] ${rendered.subject}`,
      html: rendered.html,
      text: rendered.text,
      fromEmail: BROADCAST_FROM_EMAIL,
      fromDisplayName: BROADCAST_FROM_NAME,
      replyTo: BROADCAST_FROM_EMAIL,
      categories: ['platform-broadcast-test'],
    });
    if (!messageId && !process.env.SENDGRID_API_KEY) {
      return NextResponse.json(
        { error: 'Email sending is not configured here (SENDGRID_API_KEY is not set).' },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: true, to });
  } catch (e) {
    console.error('[platform/contact-users/test]', e);
    return NextResponse.json({ error: 'The test email could not be sent.' }, { status: 502 });
  }
}
