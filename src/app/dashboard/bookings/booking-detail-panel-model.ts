import type { BookingModel } from '@/types/booking-models';
import { formatGuestDisplayName, splitLegacyGuestName } from '@/lib/guests/name';
import type { BookingDetailPanelSnapshot } from '@/app/dashboard/bookings/booking-detail-panel-snapshot';

export interface BookingDetailGuest {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  visit_count: number;
  tags?: string[];
  customer_profile_notes?: string | null;
}

export interface BookingDetailEventRow {
  id: string;
  event_type: string;
  payload: Record<string, unknown> | null;
  created_at: string;
}

export interface BookingDetailCommRow {
  id: string;
  message_type: string;
  channel: string;
  status: string;
  created_at: string;
}

export interface BookingDetail {
  id: string;
  venue_id: string;
  created_at?: string;
  created_by?: string | null;
  booking_date: string;
  booking_time: string;
  estimated_end_time: string | null;
  party_size: number;
  status: string;
  source: string;
  service_id?: string | null;
  deposit_status: string;
  deposit_amount_pence: number | null;
  dietary_notes: string | null;
  occasion: string | null;
  special_requests: string | null;
  internal_notes: string | null;
  cancellation_deadline: string | null;
  guest: BookingDetailGuest | null;
  events: BookingDetailEventRow[];
  communications: BookingDetailCommRow[];
  table_assignments?: Array<{ id: string; name: string }>;
  combination_staff_notes?: string | null;
  inferred_booking_model?: BookingModel;
  appointment_service_id?: string | null;
  service_item_id?: string | null;
  practitioner_id?: string | null;
  calendar_id?: string | null;
  experience_event_id?: string | null;
  class_instance_id?: string | null;
  resource_id?: string | null;
  event_session_id?: string | null;
  booking_model?: string | null;
  service_variant_id?: string | null;
  booking_end_time?: string | null;
  processing_time_blocks?: unknown | null;
  area_id?: string | null;
  area_name?: string | null;
  cde_context?: { title?: string | null; subtitle?: string | null } | null;
  service_variant_name?: string | null;
  /** Per-row snapshots of add-ons chosen at booking time. */
  addons?: Array<{
    id: string;
    booking_id: string;
    addon_id: string | null;
    addon_group_id: string | null;
    booking_segment_index: number | null;
    addon_name_snapshot: string;
    addon_group_name_snapshot: string | null;
    price_pence_at_booking: number;
    duration_minutes_at_booking: number;
    cost_to_business_pence_at_booking: number | null;
    created_at?: string;
  }>;
  addons_total_price_pence?: number | null;
  addons_total_duration_minutes?: number | null;
  guest_attendance_confirmed_at?: string | null;
  staff_attendance_confirmed_at?: string | null;
  client_arrived_at?: string | null;
}

export interface AssignmentSuggestion {
  source: 'single' | 'auto' | 'manual';
  table_ids: string[];
  table_names: string[];
  combined_capacity: number;
  spare_covers: number;
}

export function displayBookingGuestName(
  guest: { first_name?: string | null; last_name?: string | null } | null | undefined,
  legacyLabel?: string | null,
): string {
  if (guest) return formatGuestDisplayName(guest.first_name, guest.last_name);
  const t = legacyLabel?.trim();
  return t || 'Guest';
}

export function guestFirstLastForBookingRow(
  guest: BookingDetailGuest | null | undefined,
  legacySnapshotName?: string | null,
): { guest_first_name: string | null; guest_last_name: string | null } {
  if (guest) {
    return { guest_first_name: guest.first_name, guest_last_name: guest.last_name };
  }
  const sp = splitLegacyGuestName(legacySnapshotName ?? '');
  return {
    guest_first_name: sp.first || null,
    guest_last_name: sp.last || null,
  };
}

export function timeToMinutes(value: string): number {
  const [h, m] = value.slice(0, 5).split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function minutesToTime(value: number): string {
  const safe = ((value % (24 * 60)) + (24 * 60)) % (24 * 60);
  const h = Math.floor(safe / 60).toString().padStart(2, '0');
  const m = (safe % 60).toString().padStart(2, '0');
  return `${h}:${m}`;
}

export function estimatedEndToHHMM(iso: string | null | undefined): string | null {
  if (iso == null || typeof iso !== 'string' || !iso.trim()) return null;
  const d = new Date(iso.trim());
  if (!Number.isNaN(d.getTime())) {
    return d.toISOString().slice(11, 16);
  }
  const afterT = iso.includes('T') ? iso.split('T')[1] : null;
  const hm = (afterT ?? iso).slice(0, 5);
  if (/^\d{2}:\d{2}$/.test(hm)) return hm;
  return null;
}

export function endHHMMOrFallback(iso: string | null | undefined, startHHMM: string, fallbackDurationMins: number): string {
  const parsed = estimatedEndToHHMM(iso);
  if (parsed) return parsed;
  return minutesToTime(timeToMinutes(startHHMM) + fallbackDurationMins);
}

export function formatDateNice(value: string): string {
  const d = new Date(`${value}T12:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

export function isTableStyleBookingDetail(
  d: BookingDetail | null | undefined,
  isAppointmentFlag: boolean,
): boolean {
  const m = d?.inferred_booking_model;
  if (m === 'table_reservation') return true;
  if (m != null) return false;
  return !isAppointmentFlag;
}

export function buildPlaceholderDetail(
  id: string,
  vId: string,
  snap: BookingDetailPanelSnapshot,
): BookingDetail {
  const startTime = snap.startTime.slice(0, 5);
  const endTimeRaw = snap.endTime?.trim() ? snap.endTime.slice(0, 5) : '';
  const endTime = /^\d{2}:\d{2}$/.test(endTimeRaw)
    ? endTimeRaw
    : minutesToTime(timeToMinutes(startTime) + 90);
  const estimatedEndIso = `${snap.bookingDate}T${endTime}:00.000Z`;
  const estimatedEndDate = new Date(estimatedEndIso);
  return {
    id,
    venue_id: vId,
    booking_date: snap.bookingDate,
    booking_time: startTime,
    estimated_end_time: Number.isNaN(estimatedEndDate.getTime()) ? null : estimatedEndIso,
    party_size: snap.partySize,
    status: snap.status,
    source: snap.source?.trim() ? snap.source : '-',
    deposit_status: snap.depositStatus ?? 'Pending',
    deposit_amount_pence: null,
    dietary_notes: snap.dietaryNotes ?? null,
    occasion: snap.occasion ?? null,
    special_requests: snap.specialRequests ?? null,
    internal_notes: null,
    cancellation_deadline: null,
    guest: (() => {
      if (!snap.guestId) return null;
      const sp = splitLegacyGuestName(snap.guestName);
      return {
        id: snap.guestId,
        first_name: sp.first || null,
        last_name: sp.last || null,
        email: snap.guestEmail ?? null,
        phone: snap.guestPhone ?? null,
        visit_count: snap.guestVisitCount ?? 0,
        tags: [],
      };
    })(),
    events: [],
    communications: [],
    table_assignments: (snap.tableNames ?? []).map((name, index) => ({
      id: `snapshot-table-${index}`,
      name,
    })),
    inferred_booking_model: snap.inferredBookingModel,
    booking_model: snap.inferredBookingModel ?? null,
    practitioner_id: snap.practitionerId ?? null,
    appointment_service_id: snap.appointmentServiceId ?? null,
    service_item_id: snap.serviceItemId ?? null,
    calendar_id: snap.calendarId ?? null,
    service_variant_name: snap.serviceName ?? null,
  };
}
