import { z } from 'zod';

/**
 * Strict shape for `class_recurring_reservations.rule`.
 * v1 is single-weekday only; multi-weekday (Tue + Thu) is v2.
 */
export const classRecurringRuleSchema = z.object({
  /** 0=Sun … 6=Sat. */
  weekday: z.number().int().min(0).max(6),
  /** Local time HH:mm. Must match a real class_timetable slot for this class_type. */
  start_time: z.string().regex(/^\d{2}:\d{2}$/),
  /** ISO date string. Materialisation stops on or after this date. */
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** Absolute cap on bookings produced by this rule. */
  max_occurrences: z.number().int().min(1).max(104).optional(),
  /** Weeks between bookings (1 = weekly, 2 = fortnightly). */
  interval_weeks: z.number().int().min(1).max(8).default(1),
});

export type ClassRecurringRule = z.infer<typeof classRecurringRuleSchema>;

/** Defensive parse — returns null on invalid input (so callers can skip rather than throw). */
export function parseClassRecurringRule(raw: unknown): ClassRecurringRule | null {
  const result = classRecurringRuleSchema.safeParse(raw);
  return result.success ? result.data : null;
}

/** Normalise a `HH:mm` rule time to `HH:mm:ss` for comparison with class_timetable.start_time (Postgres `time` text). */
export function normaliseRuleStartTimeToPgTime(t: string): string {
  return t.length === 5 ? `${t}:00` : t;
}
