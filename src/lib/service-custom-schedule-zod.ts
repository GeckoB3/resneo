import { z } from 'zod';
import { timeToMinutes } from '@/lib/availability';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const timeRangeSchema = z
  .object({
    start: hhmm,
    end: hhmm,
  })
  .superRefine((tr, ctx) => {
    if (timeToMinutes(tr.end) <= timeToMinutes(tr.start)) {
      ctx.addIssue({ code: 'custom', message: 'End time must be after start time', path: ['end'] });
    }
  });

const workingHoursSchema = z.record(z.string(), z.array(timeRangeSchema));

const weeklyRuleSchema = z
  .object({
    id: z.string().min(1),
    kind: z.literal('weekly'),
    windows: workingHoursSchema,
  })
  .refine((r) => Object.keys(r.windows).length > 0, { message: 'Weekly rule needs at least one working day', path: ['windows'] });

const specificDatesRuleSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('specific_dates'),
  entries: z.array(
    z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      ranges: z.array(timeRangeSchema).min(1),
    }),
  ),
});

const dateRangePatternRuleSchema = z
  .object({
    id: z.string().min(1),
    kind: z.literal('date_range_pattern'),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    days_of_week: z.array(z.number().int().min(0).max(6)).min(1),
    ranges: z.array(timeRangeSchema).min(1),
  })
  .superRefine((r, ctx) => {
    if (r.end_date < r.start_date) {
      ctx.addIssue({ code: 'custom', message: 'End date must be on or after start date', path: ['end_date'] });
    }
  });

export const serviceCustomScheduleV2Schema = z.object({
  version: z.literal(2),
  rules: z.array(z.discriminatedUnion('kind', [weeklyRuleSchema, specificDatesRuleSchema, dateRangePatternRuleSchema])).max(40),
});

/** Legacy: day-keyed map only. */
export const legacyCustomWorkingHoursSchema = z.record(z.string(), z.array(timeRangeSchema));

export const serviceCustomScheduleStoredSchema = z.union([serviceCustomScheduleV2Schema, legacyCustomWorkingHoursSchema]);

/**
 * `custom_working_hours` as it arrives on a create/update REQUEST.
 *
 * OPTIONAL as well as nullable, and the two mean different things:
 *   - omitted   → "I am not touching the schedule", leave the stored one alone
 *   - `null`    → "clear it"
 *
 * It was nullable but NOT optional, which made it a REQUIRED key: every request
 * that left the availability section alone failed the whole parse with
 * `custom_working_hours: Invalid input`, taking the rest of the edit down with
 * it. The dashboard never saw it because its payload builder always assigns the
 * key for an admin — but a non-admin save there, and the mobile app (which
 * deliberately omits the field unless the schedule changed, since sending null
 * would wipe an existing one), both hit it on every save.
 *
 * The route already reads it as optional: `assertPatchCustomAvailabilityCoherent`
 * branches on `!== undefined` to fall back to the current row, and the staff
 * permission gate tests `hasOwnProperty`. Only the schema disagreed.
 */
export const customWorkingHoursRequestSchema = serviceCustomScheduleStoredSchema
  .nullable()
  .optional();
