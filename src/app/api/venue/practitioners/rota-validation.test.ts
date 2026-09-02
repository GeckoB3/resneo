import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import {
  ROTA_MAX_WEEKS,
  ROTA_MIN_WEEKS,
  SCHEDULE_MAX_PERIODS,
  validateCalendarSchedule,
} from '@/lib/availability/working-hours-rota';

/**
 * `schedule_periods` on PATCH /api/venue/practitioners accepts exactly what the resolver
 * will honour, and nothing else. As with days-off-validation.test.ts, the schema is rebuilt
 * from the route's own building blocks rather than imported, because the route module pulls
 * in Supabase and Next plumbing at import time; the first test pins the route to it.
 */

const ROUTE = join(process.cwd(), 'src', 'app', 'api', 'venue', 'practitioners', 'route.ts');

const timeRangeArraySchema = z.array(z.object({ start: z.string(), end: z.string() }));
const YMD = /^\d{4}-\d{2}-\d{2}$/;

const schedulePeriodsSchema = z
  .object({
    version: z.literal(1),
    periods: z
      .array(
        z.object({
          id: z.string().min(1).max(64),
          from: z.string().regex(YMD),
          until: z.string().regex(YMD).nullable(),
          cycle_start: z.string().regex(YMD).optional(),
          weeks: z.array(z.record(z.string(), timeRangeArraySchema)).min(ROTA_MIN_WEEKS).max(ROTA_MAX_WEEKS),
        }),
      )
      .max(SCHEDULE_MAX_PERIODS),
  })
  .superRefine((value, ctx) => {
    const checked = validateCalendarSchedule(value);
    if (!checked.ok) ctx.addIssue({ code: z.ZodIssueCode.custom, message: checked.error });
  });

const WEEK = { '1': [{ start: '09:00', end: '17:00' }] };
const VALID = { version: 1, periods: [{ id: 'a', from: '2026-09-07', until: '2026-10-04', weeks: [WEEK, WEEK] }] };

describe('schedule_periods validation', () => {
  it('the route carries the field on both write paths and checks it through the library', () => {
    const source = readFileSync(ROUTE, 'utf8');
    expect(source).toContain('schedule_periods: schedulePeriodsSchema.nullable().optional()');
    expect(source).toContain("new Set(['break_times', 'break_times_by_day', 'working_hours', 'schedule_periods'])");
    expect(source).toContain('schedule_periods: practitionerSchema.shape.schedule_periods.optional()');
    expect(source).toContain("'schedule_periods',");
    expect(source).toContain('validateCalendarSchedule(value)');
    // The narrowing-hours confirmation compares effective hours, periods included, and
    // writing the timeline retires the older rota column.
    expect(source).toContain("Object.prototype.hasOwnProperty.call(rest, 'schedule_periods')");
    expect(source).toContain("select('working_hours, schedule_periods, working_hours_rota, name')");
    expect(source).toContain('ucPayload.working_hours_rota = null');
    // The older field is no longer writable.
    expect(source).not.toContain('working_hours_rota: workingHoursRotaSchema');
  });

  it('accepts a valid timeline and null (remove all)', () => {
    expect(schedulePeriodsSchema.nullable().safeParse(VALID).success).toBe(true);
    expect(schedulePeriodsSchema.nullable().safeParse(null).success).toBe(true);
  });

  it('refuses what the resolver would not honour, with the library\'s message', () => {
    const bad = (periods: unknown[]) => schedulePeriodsSchema.safeParse({ version: 1, periods });
    expect(bad([{ id: 'a', from: '2026-09-08', until: null, weeks: [WEEK] }]).success).toBe(false);
    expect(bad([{ id: 'a', from: '2026-09-07', until: '2026-09-12', weeks: [WEEK] }]).success).toBe(false);
    expect(bad([{ id: 'a', from: '2026-09-07', until: null, weeks: [] }]).success).toBe(false);
    const overlapping = bad([
      { id: 'a', from: '2026-09-07', until: null, weeks: [WEEK] },
      { id: 'b', from: '2026-10-05', until: null, weeks: [WEEK] },
    ]);
    expect(overlapping.success).toBe(false);
    if (!overlapping.success) {
      expect(overlapping.error.issues.map((i) => i.message)).toContain('Schedule periods must not overlap.');
    }
  });
});
