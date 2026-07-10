import type { BookingEmailData, VenueEmailData } from '@/lib/emails/types';
import type { CommunicationLane } from './policies';

export type CommunicationPreviewSampleVariant =
  | 'table'
  | 'appointment'
  | 'class'
  | 'event'
  | 'resource';

const BASE_TABLE_BOOKING: BookingEmailData = {
  id: '00000000-0000-0000-0000-000000000000',
  guest_name: 'Sarah Connor',
  guest_email: 'sarah@example.com',
  guest_phone: '+447700900123',
  booking_date: '2026-03-20',
  booking_time: '19:00',
  party_size: 4,
  special_requests: 'Birthday celebration, window table if possible',
  dietary_notes: '1 vegetarian, 1 gluten-free',
  deposit_amount_pence: 2000,
  deposit_status: 'Paid',
  // Card-hold previews (§10.3): sample no-show fee for the card-request keys.
  card_hold_fee_pence: 2500,
  manage_booking_link:
    'https://www.resneo.com/m/AAAAAAAAAAAAAAAAAAAAAA.aaaaaaaaaaaa',
  confirm_cancel_link:
    'https://www.resneo.com/c/AAAAAAAAAAAAAAAAAAAAAA.bbbbbbbbbbbb',
};

const APPOINTMENT_BOOKING: BookingEmailData = {
  ...BASE_TABLE_BOOKING,
  guest_name: 'Alex Morgan',
  party_size: 1,
  appointment_service_name: 'Initial consultation',
  practitioner_name: 'Dr. Jordan Smith',
};

const CLASS_BOOKING: BookingEmailData = {
  ...BASE_TABLE_BOOKING,
  guest_name: 'Taylor Reed',
  party_size: 1,
  appointment_service_name: 'Vinyasa Yoga',
  practitioner_name: 'Emma Walsh',
};

const EVENT_BOOKING: BookingEmailData = {
  ...BASE_TABLE_BOOKING,
  guest_name: 'Jamie Patel',
  party_size: 2,
  booking_model: 'event_ticket',
  email_variant: 'appointment',
  appointment_service_name: 'The Great Escape',
  practitioner_name: null,
  booking_total_price_pence: 5000,
  appointment_price_display: '£50.00',
  booking_ticket_price_lines: [
    { label: 'Adult ticket', quantity: 2, unit_price_pence: 2500 },
  ],
};

const RESOURCE_BOOKING: BookingEmailData = {
  ...BASE_TABLE_BOOKING,
  guest_name: 'Chris Bell',
  party_size: 1,
  appointment_service_name: 'Tennis Court 1 — 1 hour',
  practitioner_name: null,
};

export function getPreviewVenueSample(name?: string, address?: string): VenueEmailData {
  return {
    name: name ?? 'Your venue',
    address: address ?? '123 Main Street, Belfast BT1 1AA',
    phone: '028 9000 0000',
    booking_page_url: 'https://www.resneo.com/book/your-venue',
  };
}

export function getPreviewBookingSample(
  lane: CommunicationLane,
  variant?: CommunicationPreviewSampleVariant,
): BookingEmailData {
  const effectiveVariant =
    variant ?? (lane === 'table' ? 'table' : 'appointment');

  switch (effectiveVariant) {
    case 'appointment':
      return APPOINTMENT_BOOKING;
    case 'class':
      return CLASS_BOOKING;
    case 'event':
      return EVENT_BOOKING;
    case 'resource':
      return RESOURCE_BOOKING;
    default:
      return BASE_TABLE_BOOKING;
  }
}
