import type { BookingModel } from '@/types/booking-models';

export interface GuestListRow {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  tags: string[];
  visit_count: number;
  no_show_count: number;
  last_visit_date: string | null;
  created_at: string;
  identifiability_tier?: string;
  total_bookings: number;
  cancelled_count?: number;
  upcoming_booking_count?: number;
  next_booking_date?: string | null;
  next_booking_time?: string | null;
  paid_deposit_pence?: number;
  marketing_opt_out?: boolean;
  marketing_consent?: boolean;
  custom_fields?: Record<string, unknown>;
}

export interface CommunicationRow {
  id: string;
  message_type: string;
  channel: string;
  status: string;
  created_at: string;
  booking_id: string | null;
  guest_id: string | null;
}

export interface GuestDetailGuest {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  tags: string[];
  visit_count: number;
  no_show_count: number;
  last_visit_date: string | null;
  created_at: string;
  updated_at: string;
  customer_profile_notes: string | null;
  marketing_opt_out: boolean;
  marketing_consent: boolean;
  marketing_consent_at: string | null;
  custom_fields?: Record<string, unknown>;
}

export interface GuestDetailStats {
  total_bookings: number;
  cancellations: number;
  no_shows: number;
  total_deposit_pence_paid: number;
  first_visit_date: string | null;
  last_visit_date: string | null;
  days_since_last_visit: number | null;
  days_as_customer: number;
}

export interface GuestBookingHistoryRow {
  id: string;
  booking_date: string;
  booking_time: string;
  party_size: number | null;
  status: string;
  deposit_status: string | null;
  deposit_amount_pence?: number | null;
  booking_model: BookingModel;
  kind_label: string;
  detail_label: string;
  practitioner_name: string | null;
  service_name: string | null;
}

export interface GuestDetailResponse {
  guest: GuestDetailGuest;
  stats: GuestDetailStats;
  booking_history: GuestBookingHistoryRow[];
  communications: CommunicationRow[];
  custom_field_definitions?: CustomClientFieldDefinition[];
}

export interface CustomClientFieldDefinition {
  id: string;
  venue_id: string;
  field_name: string;
  field_key: string;
  field_type: 'text' | 'number' | 'date' | 'boolean';
  is_active: boolean;
  created_at: string;
}

export interface GuestDocumentRow {
  id: string;
  venue_id: string;
  guest_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  file_size_bytes: number | null;
  category: string | null;
  created_at: string;
  deleted_at: string | null;
}

export interface TimelineEventRow {
  id: string;
  event_type: string;
  label: string;
  occurred_at: string;
  metadata?: Record<string, unknown>;
}

export interface HouseholdMemberRow {
  guest_id: string;
  name: string | null;
  role: string | null;
  is_primary: boolean;
}

export interface LoyaltyLedgerRow {
  id: string;
  delta_points: number;
  balance_after: number | null;
  reason: string | null;
  created_at: string;
}
