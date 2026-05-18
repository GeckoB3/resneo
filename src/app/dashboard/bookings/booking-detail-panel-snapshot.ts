import type { BookingModel } from '@/types/booking-models';

/** Snapshot for placeholder header / optimistic open before GET /api/venue/bookings/[id] completes. */
export interface BookingDetailPanelSnapshot {
  bookingDate: string;
  guestName: string;
  partySize: number;
  status: string;
  startTime: string;
  endTime: string;
  dietaryNotes?: string | null;
  occasion?: string | null;
  specialRequests?: string | null;
  depositStatus?: string | null;
  serviceName?: string | null;
  /** Display-only until the booking payload hydrates. */
  tableNames?: string[];
  inferredBookingModel?: BookingModel;
  guestId?: string | null;
  guestEmail?: string | null;
  guestPhone?: string | null;
  guestVisitCount?: number | null;
  source?: string | null;
  practitionerId?: string | null;
  appointmentServiceId?: string | null;
  serviceItemId?: string | null;
  calendarId?: string | null;
}
