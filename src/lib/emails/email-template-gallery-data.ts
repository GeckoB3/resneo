import type { BookingEmailData, VenueEmailData } from '@/lib/emails/types';
import type { CommunicationLane, CommunicationMessageKey } from '@/lib/communications/policies';
import { getPreviewBookingSample } from '@/lib/communications/preview-samples';
import { renderCommunicationEmail } from '@/lib/communications/renderer';
import { renderBookingConfirmation } from '@/lib/emails/templates/booking-confirmation';
import { renderStaffWelcomeEmail } from '@/lib/emails/templates/staff-welcome-email';
import { renderReminder56h } from '@/lib/emails/templates/reminder-56h';
import { renderDayOfReminderEmail } from '@/lib/emails/templates/day-of-reminder-email';

/** Rich venue sample so confirmation hero buttons (website, directions) render. */
export const EMAIL_GALLERY_DEMO_VENUE: VenueEmailData = {
  name: 'The Golden Whisk',
  address: '12 High Street, Belfast BT1 2AB',
  phone: '028 9000 0000',
  logo_url: 'https://placehold.co/200x200/4E6B78/ffffff?text=GW',
  website_url: 'https://example.com/golden-whisk',
  timezone: 'Europe/London',
  booking_page_url: 'https://www.reserveni.com/book/golden-whisk',
};

function enrichDemoBooking(base: BookingEmailData): BookingEmailData {
  return {
    ...base,
    guest_email: base.guest_email ?? 'guest@example.com',
    refund_cutoff: base.refund_cutoff ?? '2026-03-18T19:00:00Z',
    deposit_amount_pence: base.deposit_amount_pence ?? 2000,
    deposit_status: base.deposit_status ?? 'Paid',
    manage_booking_link:
      base.manage_booking_link ??
      'https://www.reserveni.com/m/AAAAAAAAAAAAAAAAAAAAAA.aaaaaaaaaaaa',
    confirm_cancel_link:
      base.confirm_cancel_link ??
      'https://www.reserveni.com/c/AAAAAAAAAAAAAAAAAAAAAA.bbbbbbbbbbbb',
  };
}

const SHARED_EMAIL_OPTS = {
  paymentLink: 'https://www.reserveni.com/pay?t=preview',
  confirmLink: 'https://www.reserveni.com/confirm/preview',
  cancelLink: 'https://www.reserveni.com/cancel/preview',
  refundMessage: '£20.00 deposit refunded to your original payment method.',
  rebookLink: EMAIL_GALLERY_DEMO_VENUE.booking_page_url ?? null,
  paymentDeadline: '20 March 2026 at 17:00',
  paymentDeadlineHours: 24,
  durationText: '45 minutes',
  preAppointmentInstructions:
    'Please arrive 10 minutes early. Bring photo ID if your treatment requires it.',
  cancellationPolicy:
    'Full refund if you cancel before the venue cutoff. No refund after that or for no-shows.',
  changeSummary: 'Your reservation time was moved from 6:30pm to 7:00pm.',
  message:
    'We wanted to reach out with a quick note about your booking. Contact us if you need anything.',
} as const;

const POLICY_MESSAGE_KEYS: CommunicationMessageKey[] = [
  'deposit_payment_request',
  'deposit_confirmation',
  'confirm_or_cancel_prompt',
  'deposit_payment_reminder',
  'pre_visit_reminder',
  'booking_modification',
  'cancellation_confirmation',
  'auto_cancel_notification',
  'custom_message',
  'no_show_notification',
  'post_visit_thankyou',
];

function laneLabel(lane: CommunicationLane): string {
  return lane === 'table' ? 'Restaurant / table lane' : 'Appointments lane';
}

function messageKeyTitle(key: CommunicationMessageKey): string {
  const titles: Record<CommunicationMessageKey, string> = {
    booking_confirmation: 'Booking confirmation',
    deposit_payment_request: 'Deposit payment request',
    deposit_confirmation: 'Deposit confirmation',
    confirm_or_cancel_prompt: 'Confirm or cancel prompt',
    deposit_payment_reminder: 'Deposit payment reminder',
    pre_visit_reminder: 'Pre-visit reminder',
    booking_modification: 'Booking modification',
    cancellation_confirmation: 'Cancellation confirmation',
    auto_cancel_notification: 'Auto-cancel (unpaid deposit)',
    custom_message: 'Custom message',
    no_show_notification: 'No-show notification',
    post_visit_thankyou: 'Post-visit thank you',
  };
  return titles[key];
}

export interface EmailGalleryItem {
  id: string;
  title: string;
  subtitle?: string;
  subject: string;
  html: string;
}

export function getEmailTemplateGalleryItems(): EmailGalleryItem[] {
  const items: EmailGalleryItem[] = [];

  const tableBooking = enrichDemoBooking(getPreviewBookingSample('table', 'table'));
  const appointmentBooking = enrichDemoBooking(
    getPreviewBookingSample('appointments_other', 'appointment'),
  );

  const bcTable = renderBookingConfirmation(
    tableBooking,
    EMAIL_GALLERY_DEMO_VENUE,
    [
      'We look forward to welcoming you — let us know if you are celebrating something special.',
      'Cancel or modify before 48 hours for a full deposit refund. After that, deposits are non-refundable.',
    ].join('\n\n'),
  );
  items.push({
    id: 'booking-confirmation-table',
    title: 'Booking confirmation',
    subtitle: 'Restaurant / table',
    subject: bcTable.subject,
    html: bcTable.html,
  });

  const bcAppt = renderBookingConfirmation(
    { ...appointmentBooking, email_variant: 'appointment' },
    EMAIL_GALLERY_DEMO_VENUE,
    [
      'Please complete the intake form before you arrive.',
      'Full refund if you cancel before 18:00 two days before your appointment.',
    ].join('\n\n'),
  );
  items.push({
    id: 'booking-confirmation-appointment',
    title: 'Booking confirmation',
    subtitle: 'Appointment / model B',
    subject: bcAppt.subject,
    html: bcAppt.html,
  });

  const customVenueNote = 'Sample venue note appended from communication settings.';

  for (const lane of ['table', 'appointments_other'] as CommunicationLane[]) {
    const variant = lane === 'table' ? 'table' : 'appointment';
    const booking = enrichDemoBooking(getPreviewBookingSample(lane, variant));

    for (const messageKey of POLICY_MESSAGE_KEYS) {
      const rendered = renderCommunicationEmail({
        lane,
        messageKey,
        booking:
          messageKey === 'deposit_payment_request'
            ? { ...booking, deposit_status: 'Pending', deposit_amount_pence: 4000 }
            : booking,
        venue: EMAIL_GALLERY_DEMO_VENUE,
        emailCustomMessage: customVenueNote,
        smsCustomMessage: null,
        ...SHARED_EMAIL_OPTS,
      });
      if (!rendered) continue;
      items.push({
        id: `${messageKey}-${lane}`,
        title: messageKeyTitle(messageKey),
        subtitle: laneLabel(lane),
        subject: rendered.subject,
        html: rendered.html,
      });
    }
  }

  const staff = renderStaffWelcomeEmail({
    venueName: EMAIL_GALLERY_DEMO_VENUE.name,
    email: 'new.staff@example.com',
    password: 'ChangeMeAfterLogin!',
    role: 'staff',
    loginUrl: 'https://www.reserveni.com/login',
  });
  items.push({
    id: 'staff-welcome',
    title: 'Staff welcome',
    subtitle: 'Dashboard credentials',
    subject: 'Your ReserveNI dashboard login details',
    html: staff.html,
  });

  const r56 = renderReminder56h(
    enrichDemoBooking(getPreviewBookingSample('table', 'table')),
    EMAIL_GALLERY_DEMO_VENUE,
    'Looking forward to seeing you — reply if your plans change.',
  );
  items.push({
    id: 'reminder-56h-email',
    title: '56-hour reminder email',
    subtitle: 'Confirm / manage (cron template)',
    subject: r56.subject,
    html: r56.html,
  });

  const dayOf = renderDayOfReminderEmail(
    enrichDemoBooking(getPreviewBookingSample('table', 'table')),
    EMAIL_GALLERY_DEMO_VENUE,
    "We're saving your favourite table by the window.",
  );
  items.push({
    id: 'day-of-reminder-email',
    title: 'Day-of reminder email',
    subtitle: 'Same-day / tonight copy',
    subject: dayOf.subject,
    html: dayOf.html,
  });

  return items;
}
