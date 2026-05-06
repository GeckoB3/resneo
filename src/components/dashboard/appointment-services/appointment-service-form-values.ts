import { DEFAULT_ENTITY_BOOKING_WINDOW } from '@/lib/booking/entity-booking-window';
import type {
  ClassPaymentRequirement,
  ProcessingTimeBlock,
  ServiceCustomScheduleV2,
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
  custom_availability_enabled: boolean;
  custom_working_hours: ServiceCustomScheduleV2;
  variants: AppointmentServiceVariantFormRow[];
  processing_time_blocks: ProcessingTimeBlock[];
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
  custom_availability_enabled: false,
  custom_working_hours: { version: 2, rules: [] },
  variants: [],
  processing_time_blocks: [],
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
