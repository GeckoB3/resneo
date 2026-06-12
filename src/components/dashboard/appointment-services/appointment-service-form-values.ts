import { DEFAULT_ENTITY_BOOKING_WINDOW } from '@/lib/booking/entity-booking-window';
import { DEFAULT_BOOKING_INTERVAL_MINUTES } from '@/lib/appointments/booking-interval';
import type {
  ClassPaymentRequirement,
  ProcessingTimeBlock,
  ServiceCustomScheduleV2,
  ServiceLocationType,
  AppointmentCatalogAddonGroup,
} from '@/types/booking-models';

/** One editable row in the variants section of the appointment service form. */
export interface AppointmentServiceVariantFormRow {
  id?: string;
  name: string;
  description: string;
  duration_minutes: number;
  buffer_minutes: number;
  price: string;
  deposit: string;
  is_active: boolean;
  processing_time_blocks: ProcessingTimeBlock[];
}

export const DEFAULT_APPOINTMENT_SERVICE_VARIANT_ROW: AppointmentServiceVariantFormRow = {
  name: '',
  description: '',
  duration_minutes: 30,
  buffer_minutes: 0,
  price: '',
  deposit: '',
  is_active: true,
  processing_time_blocks: [],
};

export type StaffMayCustomizeFlags = {
  name: boolean;
  description: boolean;
  duration: boolean;
  buffer: boolean;
  price: boolean;
  deposit: boolean;
  colour: boolean;
};

export const DEFAULT_STAFF_MAY_CUSTOMIZE: StaffMayCustomizeFlags = {
  name: false,
  description: false,
  duration: false,
  buffer: false,
  price: false,
  deposit: false,
  colour: false,
};

/** Shared shape for Add/Edit service (dashboard) and onboarding drafts (without client keys). */
export interface AppointmentServiceFormValues {
  name: string;
  description: string;
  duration_minutes: number;
  buffer_minutes: number;
  price: string;
  deposit: string;
  payment_requirement: ClassPaymentRequirement;
  colour: string;
  is_active: boolean;
  practitioner_ids: string[];
  staffMay: StaffMayCustomizeFlags;
  max_advance_booking_days: number;
  min_booking_notice_hours: number;
  cancellation_notice_hours: number;
  allow_same_day_booking: boolean;
  /** Spacing (minutes, 1-60) of bookable start times, anchored to the top of the hour. */
  booking_interval_minutes: number;
  /** Allowed start-minute offsets within the hour (0-59), or `null` for every interval mark. */
  booking_minute_marks: number[] | null;
  custom_availability_enabled: boolean;
  custom_working_hours: ServiceCustomScheduleV2;
  variants: AppointmentServiceVariantFormRow[];
  processing_time_blocks: ProcessingTimeBlock[];
  /**
   * Linked add-on groups (read-only previews used by the form). On save, the dashboard
   * sends `addon_group_links: Array<{ addon_group_id, sort_order }>` to the appointment
   * services API.
   */
  addon_group_links: AppointmentCatalogAddonGroup[];
  /** Where the service is delivered (business venue / client's address / online). */
  location_type: ServiceLocationType;
  /** Online services: meeting link sent to the client in booking emails. */
  online_meeting_url: string;
  /** Online services: joining instructions shown alongside the link in emails. */
  online_meeting_info: string;
}

export const DEFAULT_APPOINTMENT_SERVICE_FORM_VALUES: AppointmentServiceFormValues = {
  name: '',
  description: '',
  duration_minutes: 30,
  buffer_minutes: 0,
  price: '',
  deposit: '',
  payment_requirement: 'none',
  colour: '#3B82F6',
  is_active: true,
  practitioner_ids: [],
  staffMay: { ...DEFAULT_STAFF_MAY_CUSTOMIZE },
  max_advance_booking_days: DEFAULT_ENTITY_BOOKING_WINDOW.max_advance_booking_days,
  min_booking_notice_hours: DEFAULT_ENTITY_BOOKING_WINDOW.min_booking_notice_hours,
  cancellation_notice_hours: DEFAULT_ENTITY_BOOKING_WINDOW.cancellation_notice_hours,
  allow_same_day_booking: DEFAULT_ENTITY_BOOKING_WINDOW.allow_same_day_booking,
  booking_interval_minutes: DEFAULT_BOOKING_INTERVAL_MINUTES,
  booking_minute_marks: null,
  custom_availability_enabled: false,
  custom_working_hours: { version: 2, rules: [] },
  variants: [],
  processing_time_blocks: [],
  addon_group_links: [],
  location_type: 'business_venue',
  online_meeting_url: '',
  online_meeting_info: '',
};

export const APPOINTMENT_SERVICE_COLOUR_OPTIONS = [
  '#3B82F6',
  '#10B981',
  '#F59E0B',
  '#EF4444',
  '#8B5CF6',
  '#EC4899',
  '#06B6D4',
  '#84CC16',
  '#F97316',
  '#6366F1',
];
