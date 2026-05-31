import { sendEmail } from '@/lib/emails/send-email';

/**
 * Notify venue admins when a platform support session starts (impersonation / sign-in-as).
 */
export async function sendSupportSessionStartedEmails(params: {
  toEmails: string[];
  venueName: string;
  superuserDisplayName: string;
  apparentStaffLabel: string;
  reason: string;
  expiresAtIso: string;
}): Promise<void> {
  const expires = new Date(params.expiresAtIso).toLocaleString('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/London',
  });

  const subject = `Resneo support is accessing your account (${params.venueName})`;

  for (const to of params.toEmails) {
    if (!to.trim()) continue;
    const html = `
      <p>Hello,</p>
      <p><strong>${escapeHtml(params.superuserDisplayName)}</strong> from Resneo support has started a
      time-limited support session on your venue account, acting as <strong>${escapeHtml(params.apparentStaffLabel)}</strong>.</p>
      <p><strong>Reason recorded:</strong> ${escapeHtml(params.reason)}</p>
      <p>This session is set to expire around <strong>${escapeHtml(expires)}</strong> (Europe/London).</p>
      <p>If you did not expect this, contact us immediately at
      <a href="mailto:support@resneo.com">support@resneo.com</a>.</p>
      <p>— Resneo</p>
    `.trim();

    const text = [
      `Resneo support (${params.superuserDisplayName}) has started a support session on your account, acting as ${params.apparentStaffLabel}.`,
      `Reason: ${params.reason}`,
      `Session expires around ${expires} (Europe/London).`,
      `If unexpected, contact support@resneo.com`,
    ].join('\n\n');

    try {
      await sendEmail({
        to: to.trim(),
        subject,
        html,
        text,
        fromDisplayName: 'Resneo',
        disableTracking: true,
      });
    } catch (err) {
      console.error('[support-session-email] send failed:', err, { to });
    }
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
