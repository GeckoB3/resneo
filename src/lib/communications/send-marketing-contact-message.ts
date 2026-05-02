import { getSupabaseAdminClient } from '@/lib/supabase';
import { sendEmail } from '@/lib/emails/send-email';
import { sendSmsWithSegments } from '@/lib/emails/send-sms';
import { venueRowToEmailData } from '@/lib/emails/venue-email-data';

export type MarketingContactChannel = 'email' | 'sms' | 'both';

export interface SendMarketingContactMessageInput {
  venueId: string;
  guestId: string;
  subject: string;
  bodyText: string;
  channel: MarketingContactChannel;
}

export interface SendMarketingContactMessageResult {
  attempted: ('email' | 'sms')[];
  emailSent?: boolean;
  smsSent?: boolean;
  skippedReason?: string;
  error?: string;
}

/**
 * Sends a staff-authored marketing message to a guest (no booking context).
 * Requires marketing consent and not opted out. Logs rows in `communications`.
 */
export async function sendMarketingContactMessage(
  input: SendMarketingContactMessageInput,
): Promise<SendMarketingContactMessageResult> {
  const admin = getSupabaseAdminClient();

  const { data: guest, error: gErr } = await admin
    .from('guests')
    .select('id, venue_id, name, email, phone, marketing_opt_out, marketing_consent')
    .eq('id', input.guestId)
    .eq('venue_id', input.venueId)
    .maybeSingle();

  if (gErr || !guest) {
    console.error('[sendMarketingContactMessage] guest lookup failed:', gErr?.message);
    return { attempted: [], error: 'Guest not found' };
  }

  const row = guest as {
    email: string | null;
    phone: string | null;
    marketing_opt_out: boolean;
    marketing_consent: boolean;
  };

  if (row.marketing_opt_out) {
    return { attempted: [], skippedReason: 'Guest has opted out of marketing' };
  }
  if (!row.marketing_consent) {
    return { attempted: [], skippedReason: 'Guest has not consented to marketing' };
  }

  const { data: venueRow, error: vErr } = await admin
    .from('venues')
    .select('name, address, phone, booking_page_url, logo_url, timezone, reply_to_email, email')
    .eq('id', input.venueId)
    .maybeSingle();
  if (vErr || !venueRow) {
    return { attempted: [], error: 'Venue not found' };
  }

  const venue = venueRowToEmailData(venueRow as import('@/lib/emails/venue-email-data').VenueRowForGuestEmail);
  const attempted: ('email' | 'sms')[] = [];
  let emailSent = false;
  let smsSent = false;

  const logCommunication = async (channel: 'email' | 'sms', status: string, recipientEmail?: string | null, recipientPhone?: string | null) => {
    await admin.from('communications').insert({
      venue_id: input.venueId,
      booking_id: null,
      guest_id: input.guestId,
      message_type: 'marketing_bulk',
      channel,
      status,
      recipient_email: recipientEmail ?? null,
      recipient_phone: recipientPhone ?? null,
      payload: { subject: input.subject },
    });
  };

  if (input.channel === 'email' || input.channel === 'both') {
    attempted.push('email');
    const to = row.email?.trim();
    if (!to) {
      await logCommunication('email', 'skipped', null, null);
    } else {
      const externalId = await sendEmail({
        to,
        subject: input.subject,
        html: `<p>${escapeHtml(input.bodyText).replace(/\n/g, '<br/>')}</p>`,
        text: input.bodyText,
        fromDisplayName: venue.name,
        replyTo: venue.reply_to_email ?? null,
      });
      emailSent = Boolean(externalId);
      await logCommunication('email', emailSent ? 'sent' : 'failed', to, null);
    }
  }

  if (input.channel === 'sms' || input.channel === 'both') {
    attempted.push('sms');
    const phone = row.phone?.trim();
    if (!phone) {
      await logCommunication('sms', 'skipped', null, null);
    } else {
      const { sid } = await sendSmsWithSegments(phone, input.bodyText);
      smsSent = Boolean(sid);
      await logCommunication('sms', smsSent ? 'sent' : 'failed', null, phone);
    }
  }

  return { attempted, emailSent, smsSent };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
