/**
 * Communication engine. All guest messages go through this module.
 * Channels: Email (SendGrid), SMS (Twilio). Add WhatsApp = new channel + add to service.
 */

export type { MessageType, CommunicationRequest, Recipient, TemplateVariables, MessageChannel } from './types';
export { communicationService } from './service';
export { EmailChannel } from './channels/email';
export { SMSChannel } from './channels/sms';

import { communicationService } from './service';
import type { CommunicationRequest, MessageType } from './types';
import { getSupabaseAdminClient } from '@/lib/supabase';

/** Transactional / operational messages must not be blocked by marketing opt-out. */
const MARKETING_MESSAGE_TYPES = new Set<MessageType>(['post_visit_thankyou', 'dietary_digest']);

async function shouldSkipMarketingComms(request: CommunicationRequest): Promise<boolean> {
  if (!MARKETING_MESSAGE_TYPES.has(request.type)) return false;

  const supabase = getSupabaseAdminClient();
  let guestId = request.guest_id;
  if (!guestId && request.booking_id) {
    const { data: row } = await supabase.from('bookings').select('guest_id').eq('id', request.booking_id).maybeSingle();
    guestId = row?.guest_id ?? undefined;
  }
  if (!guestId) return false;

  const { data: guest } = await supabase
    .from('guests')
    .select('marketing_opt_out, user_id')
    .eq('id', guestId)
    .maybeSingle();
  const row = guest as { marketing_opt_out?: boolean | null; user_id?: string | null } | null;

  // Per-venue opt-out, unchanged.
  if (row?.marketing_opt_out) return true;

  // Account-level preference (P0-14, G21). Until now the profile toggle saved
  // and nothing read it, so a customer could switch marketing off, watch it
  // persist, and keep receiving it. The two checks are deliberately
  // independent: the guest row is per venue, this is per account, and a
  // customer who has said no in either place has said no.
  //
  // Only consulted for a LINKED guest. A guest with no account has no
  // account-level preference to honour, and the per-venue flag above is the
  // whole answer for them.
  if (row?.user_id) {
    const { accountAllowsMarketingEmail } = await import('@/lib/notifications/customer-email-consent');
    if (!(await accountAllowsMarketingEmail(supabase, row.user_id))) return true;
  }

  return false;
}

export async function sendCommunication(request: CommunicationRequest): Promise<void> {
  if (await shouldSkipMarketingComms(request)) {
    console.warn(
      JSON.stringify({
        event: 'communication_skipped_marketing_opt_out',
        type: request.type,
        guest_id: request.guest_id,
        booking_id: request.booking_id,
      }),
    );
    return;
  }

  await communicationService.send(
    request.type,
    request.recipient,
    request.payload,
    { venue_id: request.venue_id, booking_id: request.booking_id, guest_id: request.guest_id },
  );
}
