import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

/**
 * Stage 1 item 8 / decision (G): `days_off` accepts exact ISO dates only.
 *
 * The engines honour BOTH exact dates and lowercase weekday names
 * (`appointment-engine.ts:212-214`, `resource-booking-engine.ts:114-119`), so a stored
 * `"mon"` is a permanent recurring closure that no dashboard screen shows and the target
 * scheduling model cannot express. Production carries none (query Q5, zero rows), and this
 * validation is the only thing keeping that true while Stages 2 to 5 stop expecting them:
 * `/api/venue/practitioners` also serves the mobile app from a separate repository, so
 * "no in-repo caller sends one" is not a guarantee.
 *
 * The schema is rebuilt here from the route's own source rather than imported, because the
 * route module pulls in Supabase and Next request plumbing at import time. The first test
 * pins the route to the shape the rest of the file exercises, so the two cannot drift.
 */

const ROUTE = join(process.cwd(), 'src', 'app', 'api', 'venue', 'practitioners', 'route.ts');

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const WEEKDAY_NAMES = new Set(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']);

const daysOffSchema = z.array(
  z.string().superRefine((value, ctx) => {
    if (ISO_DATE.test(value)) {
      // Date.parse rolls 2026-02-30 over to 2 March rather than failing, so round-trip the
      // components instead of trusting it.
      const [y, m, d] = value.split('-').map(Number);
      const dt = new Date(Date.UTC(y!, m! - 1, d!));
      const roundTrips =
        dt.getUTCFullYear() === y && dt.getUTCMonth() === m! - 1 && dt.getUTCDate() === d;
      if (!roundTrips) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${value} is not a real date.` });
      }
      return;
    }
    if (WEEKDAY_NAMES.has(value.toLowerCase())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Repeating days off are set in working hours, not here. Leave the weekday unticked in working hours instead.',
      });
      return;
    }
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Days off must be dates in YYYY-MM-DD form. Received "${value}".`,
    });
  }),
);

describe('days_off validation (decision G)', () => {
  it('the route no longer accepts a bare string array', () => {
    const source = readFileSync(ROUTE, 'utf8');

    expect(source).toContain('days_off: daysOffSchema.optional()');
    expect(source).not.toContain('days_off: z.array(z.string()).optional()');
    // PATCH reuses the same schema via .partial(), so one definition covers both verbs.
    expect(source).toContain('practitionerSchema.partial()');
  });

  it('accepts exact ISO dates, including an empty list', () => {
    expect(daysOffSchema.safeParse([]).success).toBe(true);
    expect(daysOffSchema.safeParse(['2026-12-25', '2027-01-01']).success).toBe(true);
  });

  it('rejects a recurring weekday name, which is the entry the new model cannot express', () => {
    for (const name of ['mon', 'Sun', 'SAT']) {
      const result = daysOffSchema.safeParse([name]);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]!.message).toMatch(/working hours/);
      }
    }
  });

  it('rejects an impossible date that still looks like one', () => {
    const result = daysOffSchema.safeParse(['2026-02-30']);
    expect(result.success).toBe(false);
  });

  it('rejects free text, and names the value so the caller can find it', () => {
    const result = daysOffSchema.safeParse(['Monday']);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]!.message).toContain('Monday');
      expect(result.error.issues[0]!.message).toMatch(/YYYY-MM-DD/);
    }
  });

  it('rejects the whole list when only one entry is bad', () => {
    expect(daysOffSchema.safeParse(['2026-12-25', 'mon']).success).toBe(false);
  });
});
