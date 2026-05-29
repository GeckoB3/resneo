import { inferBookingRowModel } from '@/lib/booking/infer-booking-row-model';
import { staffRebookInitialDate, type GuestBookingUpcomingRow } from '@/lib/booking/guest-booking-upcoming';
import {
  buildAppointmentRebookComments,
  type StaffRebookBootstrapPayloadV1,
  type StaffRebookGuestPrefill,
} from '@/lib/booking/staff-rebook-bootstrap';

/** Booking fields sufficient for staff “Rebook” payloads and guest-history time badges. */
export interface StaffRebookBootstrapBookingSource extends GuestBookingUpcomingRow {
  booking_time: string;
  party_size: number;
  estimated_end_time: string | null;
  booking_end_time?: string | null;
  booking_model?: string | null;
  experience_event_id?: string | null;
  class_instance_id?: string | null;
  resource_id?: string | null;
  event_session_id?: string | null;
  calendar_id?: string | null;
  service_item_id?: string | null;
  practitioner_id?: string | null;
  appointment_service_id?: string | null;
  service_variant_id?: string | null;
  service_id?: string | null;
  area_id?: string | null;
}

/** HH:mm from DB ISO timestamp; null if missing or unparseable. */
function estimatedEndToHHMM(iso: string | null | undefined): string | null {
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

/** Postgres `time` → HH:mm when parseable. */
function bookingEndWallHm(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const t = raw.trim();
  const hm = t.length >= 5 ? t.slice(0, 5) : t;
  return /^\d{2}:\d{2}$/.test(hm) ? hm : null;
}

/** Minimal fields to resolve wall-clock / ISO booking end. */
export type BookingScheduleEndSource = {
  booking_time: string;
  booking_end_time?: string | null;
  estimated_end_time?: string | null;
};

/** Prefer wall-clock booking end (`booking_end_time`) before ISO-derived end. */
export function bookingScheduleWallEndHm(row: BookingScheduleEndSource): string | null {
  const wallEnd = bookingEndWallHm(row.booking_end_time ?? null);
  if (wallEnd) return wallEnd;
  return estimatedEndToHHMM(row.estimated_end_time);
}

export function bookingSourceWallEndHm(row: StaffRebookBootstrapBookingSource): string | null {
  return bookingScheduleWallEndHm(row);
}

function hmToMinutes(hm: string): number {
  const [hRaw, mRaw] = hm.split(':');
  const h = Number.parseInt(hRaw, 10);
  const m = Number.parseInt(mRaw, 10);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return NaN;
  return h * 60 + m;
}

export function bookingSourceDurationMinutes(row: StaffRebookBootstrapBookingSource): number | null {
  const st = row.booking_time.length >= 5 ? row.booking_time.slice(0, 5) : '';
  const endHm = bookingSourceWallEndHm(row);
  if (!st || !endHm) return null;
  const a = hmToMinutes(st);
  let b = hmToMinutes(endHm);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (b < a) b += 24 * 60;
  const mins = b - a;
  return mins > 0 ? mins : null;
}

function appointmentRebookIds(row: StaffRebookBootstrapBookingSource): {
  serviceId: string;
  practitionerId: string;
  variantId: string | null;
} | null {
  const model = inferBookingRowModel(row);
  if (model === 'unified_scheduling') {
    const cid = row.calendar_id?.trim();
    const sid = row.service_item_id?.trim();
    if (cid && sid) {
      return { serviceId: sid, practitionerId: cid, variantId: row.service_variant_id?.trim() ?? null };
    }
    return null;
  }
  if (model === 'practitioner_appointment') {
    const pid = row.practitioner_id?.trim();
    const aid = row.appointment_service_id?.trim();
    if (pid && aid) return { serviceId: aid, practitionerId: pid, variantId: null };
  }
  return null;
}

/**
 * Build one-shot `/dashboard/bookings/new` bootstrap payload from any booking-like row that staff can rebook:
 * tables, practitioner / unified appointments, and resource bookings. Returns null for unsupported models (classes, bare events).
 */
export interface BuildStaffRebookBootstrapOptions {
  /** When set, sets `initialDate` on the payload (upcoming → booking date, previous → today). */
  venueTimeZone?: string;
}

export function buildStaffRebookBootstrapFromBookingSource(
  row: StaffRebookBootstrapBookingSource,
  guestPrefill: StaffRebookGuestPrefill | undefined,
  options?: BuildStaffRebookBootstrapOptions,
): StaffRebookBootstrapPayloadV1 | null {
  const guest = guestPrefill ?? {};
  const model = inferBookingRowModel(row);
  const initialDate = options?.venueTimeZone
    ? staffRebookInitialDate(row, options.venueTimeZone)
    : undefined;
  const withInitialDate = <T extends StaffRebookBootstrapPayloadV1>(payload: T): T =>
    initialDate ? { ...payload, initialDate } : payload;

  if (model === 'table_reservation') {
    const coverMins = bookingSourceDurationMinutes(row) ?? 90;
    return withInitialDate({
      v: 1,
      surface: 'table_reservation',
      table: {
        partySize: row.party_size,
        serviceId: row.service_id ?? null,
        areaId: row.area_id ?? null,
        coverDurationMinutes: coverMins,
      },
      guest,
    });
  }

  const apptIds = appointmentRebookIds(row);
  if ((model === 'unified_scheduling' || model === 'practitioner_appointment') && apptIds) {
    return withInitialDate({
      v: 1,
      surface: 'unified_scheduling',
      appointment: {
        serviceId: apptIds.serviceId,
        practitionerId: apptIds.practitionerId,
        variantId: apptIds.variantId,
        durationMinutes: bookingSourceDurationMinutes(row),
      },
      guest,
      appointmentComments: buildAppointmentRebookComments(guest),
    });
  }

  if (model === 'resource_booking') {
    const resourceId = row.resource_id?.trim();
    if (!resourceId) return null;
    return withInitialDate({
      v: 1,
      surface: 'resource_booking',
      resource: {
        resourceId,
        durationMinutes: bookingSourceDurationMinutes(row),
      },
      guest,
    });
  }

  return null;
}
