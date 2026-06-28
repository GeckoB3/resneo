import sgMail from '@sendgrid/mail';

const apiKey = process.env.SENDGRID_API_KEY;
/** Verified sender domain address; display name is set per message (business name). */
const defaultFromAddress = process.env.SENDGRID_FROM_EMAIL ?? 'bookings@resneo.com';

if (apiKey) {
  sgMail.setApiKey(apiKey);
}

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text: string;
  /**
   * Display name for the From header, e.g. venue name.
   */
  fromDisplayName?: string;
  /**
   * Override the envelope From address for this message. Must be a SendGrid-verified sender
   * (e.g. hello@resneo.com). Defaults to {@link defaultFromAddress} (bookings@resneo.com), so
   * every existing caller keeps sending from bookings@ unless it opts in here.
   */
  fromEmail?: string;
  /**
   * When set, guest replies go to this address instead of the platform inbox.
   */
  replyTo?: string | null;
  /**
   * When true, disables SendGrid click and open tracking for this message.
   * Required for auth links (magic links, password reset): tracking wraps URLs in
   * `*.sendgrid.net` / branded redirect hosts and breaks Supabase PKCE verification.
   */
  disableTracking?: boolean;
}

/**
 * Send an email via SendGrid with pre-rendered HTML content.
 * Returns the SendGrid message ID on success, null if not configured.
 */
export async function sendEmail(opts: SendEmailOptions): Promise<string | null> {
  if (!opts.to?.trim()) return null;

  if (!apiKey) {
    console.warn('[sendEmail] SENDGRID_API_KEY not set; skipping email:', { to: opts.to, subject: opts.subject });
    return null;
  }

  const fromAddress = opts.fromEmail?.trim() || defaultFromAddress;
  const fromBlock =
    opts.fromDisplayName?.trim() ?
      { email: fromAddress, name: opts.fromDisplayName.trim() }
    : fromAddress;

  const replyTo = opts.replyTo?.trim() || undefined;

  try {
    const [response] = await sgMail.send({
      to: opts.to,
      from: fromBlock,
      ...(replyTo ? { replyTo } : {}),
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
      ...(opts.disableTracking
        ? {
            trackingSettings: {
              clickTracking: { enable: false, enableText: false },
              openTracking: { enable: false },
            },
          }
        : {}),
    });
    const messageId = response?.headers?.['x-message-id'] as string | undefined;
    return messageId ?? null;
  } catch (err: unknown) {
    const sgErr = err as { code?: number; response?: { body?: unknown } };
    if (sgErr?.response?.body) {
      console.error('[sendEmail] SendGrid error body:', JSON.stringify(sgErr.response.body));
    }
    throw err;
  }
}
