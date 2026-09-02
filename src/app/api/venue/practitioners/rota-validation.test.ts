import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { parseWorkingHoursRota, ROTA_MAX_WEEKS, ROTA_MIN_WEEKS } from '@/lib/availability/working-hours-rota';

/**
 * `working_hours_rota` on PATCH /api/venue/practitioners accepts exactly what the resolver
 * will honour, and nothing else. As with days-off-validation.test.ts, the schema is rebuilt
 * from the route's own building blocks rather than imported, because the route module pulls
 * in Supabase and Next plumbing at import time; the first test pins the route to it.
 */

const ROUTE = join(process.cwd(), 'src', 'app', 'api', 'venue', 'practitioners', 'route.ts');

const timeRangeArraySchema = z.array(z.object({ start: z.string(), end: z.string() }));

const workingHoursRotaSchema = z
  .object({
    version: z.literal(1),
    cycle_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    weeks: z.array(z.record(z.string(), timeRangeArraySchema)).min(ROTA_MIN_WEEKS).max(ROTA_MAX_WEEKS),
    repeat_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  })
  .superRefine((value, ctx) => {
    if (!parseWorkingHoursRota(value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'invalid rota' });
    }
  });

const WEEK = { '1': [{ start: '09:00', end: '17:00' }] };
const VALID = { version: 1, cycle_start: '2026-09-07', weeks: [WEEK, WEEK], repeat_until: null };

describe('working_hours_rota validation', () => {
  it('the route carries the rota field on both the admin and staff write paths', () => {
    const source = readFileSync(ROUTE, 'utf8');
    expect(source).toContain('working_hours_rota: workingHoursRotaSchema.nullable().optional()');
    expect(source).toContain("'working_hours_rota',");
    expect(source).toContain("new Set(['break_times', 'break_times_by_day', 'working_hours', 'working_hours_rota'])");
    expect(source).toContain('working_hours_rota: practitionerSchema.shape.working_hours_rota.optional()');
    // The narrowing-hours confirmation compares effective hours, rota included.
    expect(source).toContain("Object.prototype.hasOwnProperty.call(rest, 'working_hours_rota')");
    expect(source).toContain("select('working_hours, working_hours_rota, name')");
  });

  it('accepts a valid rota and null (remove)', () => {
    expect(workingHoursRotaSchema.nullable().safeParse(VALID).success).toBe(true);
    expect(workingHoursRotaSchema.nullable().safeParse({ ...VALID, repeat_until: '2026-11-29' }).success).toBe(true);
    expect(workingHoursRotaSchema.nullable().safeParse(null).success).toBe(true);
  });

  it('refuses a non-Monday start, a bad week count, a bad time, and an end before the start', () => {
    expect(workingHoursRotaSchema.safeParse({ ...VALID, cycle_start: '2026-09-08' }).success).toBe(false);
    expect(workingHoursRotaSchema.safeParse({ ...VALID, weeks: [WEEK] }).success).toBe(false);
    expect(workingHoursRotaSchema.safeParse({ ...VALID, weeks: Array(7).fill(WEEK) }).success).toBe(false);
    expect(workingHoursRotaSchema.safeParse({ ...VALID, weeks: [WEEK, { '1': [{ start: '9', end: '17:00' }] }] }).success).toBe(false);
    expect(workingHoursRotaSchema.safeParse({ ...VALID, repeat_until: '2026-09-01' }).success).toBe(false);
    expect(workingHoursRotaSchema.safeParse({ ...VALID, version: 2 }).success).toBe(false);
  });
});
