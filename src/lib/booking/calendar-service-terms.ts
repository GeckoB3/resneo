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
