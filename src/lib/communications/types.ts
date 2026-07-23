/**
 * Communication engine types. Adding WhatsApp = new channel implementation.
 */

export type MessageType =
  | 'booking_confirmation'
  | 'deposit_payment_request'
  | 'deposit_payment_reminder'
  | 'card_hold_request'
  | 'card_hold_payment_reminder'
  | 'pre_visit_reminder'
  | 'confirm_or_cancel_prompt'
  | 'dietary_digest'
  | 'post_visit_thankyou'
  | 'auto_cancel_notification'
  | 'booking_modification'
  | 'cancellation_confirmation'
  | 'no_show_notification'
  | 'payment_receipt'
  | 'custom_message';

export interface Recipient {
  email?: string;
  phone?: string;
}

/** Merge variables for templates. All optional. */
export interface TemplateVariables {
  guest_name?: string;
  venue_name?: string;
  booking_date?: string;
  booking_time?: string;
  party_size?: string | number;
  deposit_amount?: string | number;
  cancellation_deadline?: string;
  venue_address?: string;
  dietary_notes?: string;
  occasion?: string;
  confirm_link?: string;
  cancel_link?: string;
  payment_link?: string;
  manage_booking_link?: string;
  short_manage_link?: string;
  message?: string;
  /** Auto-cancel comms (§12.1): true when a card hold, not a deposit, timed out. */
  card_hold?: boolean;
  [key: string]: string | number | boolean | undefined;
}

export interface CompiledTemplate {
  subject?: string;
  body: string;
  /** Pre-rendered HTML for email. When set, the EmailChannel uses this instead of converting body to HTML. */
  html?: string;
}

export interface MessageChannel {
  send(recipient: Recipient, template: CompiledTemplate, variables: TemplateVariables): Promise<void>;
}

export interface CommunicationRequest {
  type: MessageType;
  recipient: Recipient;
  payload: TemplateVariables;
  venue_id?: string;
  booking_id?: string;
  guest_id?: string;
}
