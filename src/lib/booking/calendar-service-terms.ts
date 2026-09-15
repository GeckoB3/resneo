import type { ProcessingTimeBlock } from '@/types/booking-models';
import { fitProcessingBlocksToDuration } from '@/lib/appointments/processing-time';

/**
 * One calendar's terms for one service: the single place that decides precedence between a
 * service's own values, the calendar's own values and a chosen option
 * (Docs/collective-one-venue-plan.md §6.6, TERMS-01).
 *
 * Today a calendar can hold two values of its own on `calendar_service_assignments`:
 * `custom_price_pence` and `custom_duration_minutes`. Every catalogue, availability, create,
 * email, payment and import path used to write `custom ?? service` by hand, and they drifted
 * (the month loader applied a length twice, the combined page applied one calendar's values to
 * all of them). Read them through here. TERMS-04 (`calendar-terms-sweep.test.ts`) fails when a
 * new hand-written read appears.
 *
 * Precedence, as booking-time pricing has always applied it (`applyVariantToService`):
 *   price     option, else calendar, else service
 *   length    staff-entered length, else option, else calendar, else service; add-on minutes on top
 *   buffer    option, else service
 *   deposit   option, else service
 *   pattern   the option's own processing pattern, else the service's re-fitted to the length
 *
 * A calendar value of 0 is a real value (a calendar offering the service free); only
 * null or a non-number means "not set".
 *
 * W1b extends this to the other per-calendar fields and their flags; callers do not change.
 */

/** The assignment columns this resolver reads. Select these, then pass the row in. */
export const CALENDAR_TERMS_ASSIGNMENT_COLUMNS = 'custom_duration_minutes, custom_price_pence';

export interface CalendarAssignmentValues {
  custom_price_pence?: number | null;
  custom_duration_minutes?: number | null;
}

const setNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The calendar's price for a service: its own when set, else the service's. */
export function calendarPricePence(
  servicePricePence: number | null | undefined,
  assignment: CalendarAssignmentValues | null | undefined,
): number | null {
  const own = assignment?.custom_price_pence;
  return setNumber(own) ? own : servicePricePence ?? null;
}

/** The calendar's length for a service: its own when set, else the service's. */
export function calendarDurationMinutes(
  serviceDurationMinutes: number,
  assignment: CalendarAssignmentValues | null | undefined,
): number {
  const own = assignment?.custom_duration_minutes;
  return setNumber(own) ? own : serviceDurationMinutes;
}

export interface TermsService {
  price_pence: number | null;
  duration_minutes: number;
  buffer_minutes?: number | null;
  deposit_pence?: number | null;
  processing_time_blocks?: ProcessingTimeBlock[] | null;
}

export interface TermsOption {
  price_pence: number | null;
  duration_minutes: number;
  buffer_minutes?: number | null;
  deposit_pence?: number | null;
  processing_time_blocks?: ProcessingTimeBlock[] | null;
}

export interface CalendarServiceTerms {
  pricePence: number | null;
  /** The core length, before add-on minutes. */
  durationMinutes: number;
  /** Core length plus add-on minutes: what the booking occupies before its buffer. */
  totalDurationMinutes: number;
  bufferMinutes: number;
  depositPence: number | null;
  processingBlocks: ProcessingTimeBlock[];
}

export function resolveCalendarServiceTerms(params: {
  service: TermsService;
  assignment?: CalendarAssignmentValues | null;
  option?: TermsOption | null;
  addonMinutes?: number;
  staffLengthMinutes?: number | null;
}): CalendarServiceTerms {
  const { service, assignment, option } = params;
  const calendarLength = calendarDurationMinutes(service.duration_minutes, assignment);
  const optionLength = option ? option.duration_minutes : calendarLength;
  const durationMinutes = setNumber(params.staffLengthMinutes) ? params.staffLengthMinutes : optionLength;

  const optionBlocks = option?.processing_time_blocks ?? [];
  const processingBlocks =
    optionBlocks.length > 0 && durationMinutes === option!.duration_minutes
      ? optionBlocks
      : fitProcessingBlocksToDuration(optionBlocks.length > 0 ? optionBlocks : service.processing_time_blocks ?? [], {
          fromDurationMinutes: optionBlocks.length > 0 ? option!.duration_minutes : service.duration_minutes,
          toDurationMinutes: durationMinutes,
        }).blocks;

  return {
    pricePence: option ? option.price_pence : calendarPricePence(service.price_pence, assignment),
    durationMinutes,
    totalDurationMinutes: durationMinutes + Math.max(0, params.addonMinutes ?? 0),
    bufferMinutes: (option ? option.buffer_minutes : service.buffer_minutes) ?? 0,
    depositPence: option ? option.deposit_pence ?? service.deposit_pence ?? null : service.deposit_pence ?? null,
    processingBlocks,
  };
}

/**
 * The assignment columns the loaders select to build a calendar's link row: the seven values a
 * calendar can hold of its own (W8, migration 20270214140000).
 */
export const CALENDAR_ASSIGNMENT_LINK_COLUMNS =
  'id, calendar_id, service_item_id, custom_name, custom_description, custom_duration_minutes, custom_buffer_minutes, custom_price_pence, custom_deposit_pence, custom_colour';

/** A calendar's stored values, as `calendar_service_assignments` holds them. */
export interface CalendarAssignmentRow extends CalendarAssignmentValues {
  custom_name?: string | null;
  custom_description?: string | null;
  custom_buffer_minutes?: number | null;
  custom_deposit_pence?: number | null;
  custom_colour?: string | null;
}

/** The service's staff permission flags, as `service_items` holds them. */
export interface ServiceCustomisationFlags {
  staff_may_customize_name?: boolean | null;
  staff_may_customize_description?: boolean | null;
  staff_may_customize_duration?: boolean | null;
  staff_may_customize_buffer?: boolean | null;
  staff_may_customize_price?: boolean | null;
  staff_may_customize_deposit?: boolean | null;
  staff_may_customize_colour?: boolean | null;
}

/**
 * A calendar's values that apply to a booking, gated by the service's staff permission flags.
 *
 * Name, description, buffer, deposit and colour apply only while their flag is on: a value stored
 * while the flag was on stops applying when an admin turns it off (R8).
 *
 * Price and length apply AS STORED, flag or not, exactly as they have always applied (SB-12).
 * Gating them would change what a calendar charges today wherever a price was stored and the
 * flag later turned off (one such row on staging, 2026-09-15). That is an owner decision (D6
 * clears stored values when a flag goes off), so it is not taken silently here.
 */
export function applicableCalendarValues(
  assignment: CalendarAssignmentRow | null | undefined,
  flags: ServiceCustomisationFlags | null | undefined,
): Required<CalendarAssignmentRow> {
  const on = (flag: boolean | null | undefined) => flag === true;
  const text = (v: string | null | undefined) => (typeof v === 'string' && v.trim() !== '' ? v : null);
  const num = (v: number | null | undefined) => (setNumber(v) ? v : null);
  return {
    custom_price_pence: num(assignment?.custom_price_pence),
    custom_duration_minutes: num(assignment?.custom_duration_minutes),
    custom_name: on(flags?.staff_may_customize_name) ? text(assignment?.custom_name) : null,
    custom_description: on(flags?.staff_may_customize_description) ? text(assignment?.custom_description) : null,
    custom_buffer_minutes: on(flags?.staff_may_customize_buffer) ? num(assignment?.custom_buffer_minutes) : null,
    custom_deposit_pence: on(flags?.staff_may_customize_deposit) ? num(assignment?.custom_deposit_pence) : null,
    custom_colour: on(flags?.staff_may_customize_colour) ? text(assignment?.custom_colour) : null,
  };
}
