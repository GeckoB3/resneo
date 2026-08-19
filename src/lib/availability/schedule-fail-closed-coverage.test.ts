import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Which routes fail closed, stated once, where it can be checked.
 *
 * Stage 7 proved the RULE centrally (`schedule-unavailable-response.test.ts`, 8 fixtures) and
 * then relied on live injection per route. That proves the helper behaves, and proves nothing
 * about which routes still call it. Two rounds of audit (the app repo's R20 delta, then a
 * derived sweep here) found four routes that reach a fail-open read and were never wrapped:
 * `booking/class-offerings`, `booking/event-offerings`, and the staff twins of both. Every one
 * of them was missed by an enumeration that had been typed by hand rather than derived.
 *
 * So the list lives here, and a route that quietly loses its wrapper fails this file rather
 * than waiting for the next audit.
 *
 * The `MUST_NOT_WRAP` half matters more than it looks: see the comment on it.
 */

const API = path.join(process.cwd(), 'src', 'app', 'api');

function routeSource(route: string): string {
  return fs.readFileSync(path.join(API, ...route.split('/'), 'route.ts'), 'utf8');
}

/** Every GET route that reaches a `reportAvailabilityReadFailure` site and must fail closed. */
const MUST_WRAP: readonly string[] = [
  // Stage 7's original five (guest).
  'booking/appointment-calendar',
  'booking/availability',
  'booking/class-instances',
  'booking/resource-calendar',
  'booking/unified-availability',
  // Guest routes Stage 7's enumeration missed.
  'booking/class-offerings',
  'booking/event-offerings',
  // Staff reads. The scope note excludes staff WRITE validators, not staff reads: these
  // block nothing, they answer a question, and answering it wrongly is what (J) prevents.
  'venue/appointment-calendar',
  'venue/appointment-availability',
  'venue/class-offerings',
  'venue/event-offerings',
  'venue/resource-availability',
  'venue/resource-calendar',
];

/**
 * Routes that reach a fail-open read and must NOT be wrapped, each for a stated reason.
 *
 * This is not a to-do list. Wrapping anything here would be a regression, and for
 * `venue/waitlist` it would be a SILENT one: that route degrades per entry, inside its own
 * `withScheduleReadContext`, and a nested context shadows an outer one
 * (`AsyncLocalStorage.getStore()` returns the innermost store). A route-level wrapper added
 * on top would therefore see an empty failure list for every per-entry read and return a
 * clean 200, while still converting failures from reads OUTSIDE the loop into 503s. Partial,
 * unpredictable, and invisible to a handler-level injection fixture. The two mechanisms are
 * mutually exclusive; see `schedule-read-context.test.ts` for the proof.
 */
const MUST_NOT_WRAP: ReadonlyArray<{ route: string; because: string }> = [
  {
    route: 'venue/calendar-grid',
    because:
      'getCalendarGrid discards `error` on five reads and reports none of them, so a wrapper ' +
      'would be inert and read as protection. Instrumentation first, then wrap.',
  },
];

describe('fail-closed coverage', () => {
  it.each(MUST_WRAP)('%s routes its GET through withScheduleFailClosed', (route) => {
    const src = routeSource(route);
    expect(src).toContain("from '@/lib/availability/schedule-unavailable-response'");
    expect(src).toContain('withScheduleFailClosed(');
  });

  it.each(MUST_NOT_WRAP)('$route is deliberately not wrapped', ({ route }) => {
    expect(routeSource(route)).not.toContain('withScheduleFailClosed');
  });
});
