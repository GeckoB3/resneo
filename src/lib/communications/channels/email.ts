import sgMail from '@sendgrid/mail';
import type { MessageChannel, Recipient, CompiledTemplate, TemplateVariables } from '../types';

const apiKey = process.env.SENDGRID_API_KEY;
const fromEmail = process.env.SENDGRID_FROM_EMAIL ?? 'hello@reserveni.com';

if (apiKey) {
  sgMail.setApiKey(apiKey);
}

function getBaseUrl(): string {
  return process.env.NEXT_PUBLIC_BASE_URL || 'https://www.reserveni.com';
}

/**
 * Convert plain-text email body to a proper table-based HTML email.
 * Uses tables for layout (industry standard for email client compatibility).
 * Converts action links (manage booking, pay deposit) into styled CTA buttons.
 */
function textToHtml(text: string): string {
  const base = getBaseUrl();

  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const buttonUrls = new Set<string>();

  // Convert action phrases into CTA buttons using table-based layout (most reliable across email clients).
  const withButtons = escaped.replace(
    /((?:View or cancel your booking|Manage your booking|Pay your deposit here):\s*)(https?:\/\/[^\s]+)/gi,
    (_match, _label, url) => {
      buttonUrls.add(url as string);
      const cleanLabel = (_label as string).replace(/:\s*$/, '');
      return [
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0">',
        '<tr><td style="background-color:#4E6B78;border-radius:8px;text-align:center">',
        `<a href="${url}" target="_blank" style="display:inline-block;padding:14px 28px;color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;font-size:14px;font-weight:600;text-decoration:none">${cleanLabel}</a>`,
        '</td></tr></table>',
      ].join('');
    },
  );

  // Convert remaining bare URLs into clickable text links.
  const withLinks = withButtons.replace(
    /(?<!=["'])(https?:\/\/[^\s<>"']+)/g,
    (url) => buttonUrls.has(url) ? url : `<a href="${url}" target="_blank" style="color:#4E6B78;text-decoration:underline">${url}</a>`,
  );

  const bodyHtml = withLinks.replace(/\n/g, '<br>\n');

  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>',
    '<body style="margin:0;padding:0;background-color:#f8fafc">',
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f8fafc">',
    '<tr><td align="center" style="padding:24px 16px">',
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="max-width:560px;width:100%">',

    // Logo
    '<tr><td style="padding:0 0 20px 0;border-bottom:3px solid #4E6B78">',
    `<img src="${base}/Logo.png" alt="ReserveNI" width="120" style="height:auto;display:block" />`,
    '</td></tr>',

    // Body
    '<tr><td style="padding:24px 0;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;font-size:15px;line-height:1.6;color:#1e293b">',
    bodyHtml,
    '</td></tr>',

    // Footer
    '<tr><td style="padding:20px 0 0 0;border-top:1px solid #e2e8f0;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;font-size:12px;color:#94a3b8">',
    `<a href="${base}/privacy" target="_blank" style="color:#94a3b8;text-decoration:underline">Privacy Policy</a>`,
    ' &middot; ',
    `<a href="${base}/terms" target="_blank" style="color:#94a3b8;text-decoration:underline">Website Terms of Use</a>`,
    '</td></tr>',

    '</table>',
    '</td></tr></table>',
    '</body></html>',
  ].join('\n');
}

export class EmailChannel implements MessageChannel {
  async send(recipient: Recipient, template: CompiledTemplate, _variables: TemplateVariables): Promise<void> {
    const email = recipient.email;
    if (!email?.trim()) return;

    if (!apiKey) {
      console.log('[EmailChannel] SENDGRID_API_KEY not set; would send:', { to: email, subject: template.subject });
      return;
    }

    try {
      await sgMail.send({
        to: email,
        from: fromEmail,
        subject: template.subject ?? 'ReserveNI',
        text: template.body,
        html: template.html ?? textToHtml(template.body),
      });
    } catch (err: unknown) {
      const sgErr = err as { code?: number; response?: { body?: unknown } };
      if (sgErr?.response?.body) {
        console.error('[EmailChannel] SendGrid error body:', JSON.stringify(sgErr.response.body));
      }
      throw err;
    }
  }
}
