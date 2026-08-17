import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * SA-M9, extended (plan §1.2 item 20, Stage 1 item 5).
 *
 * No route whose answer depends on venue hours, closures, leave or breaks may be
 * CDN-cached, because nothing in the codebase revalidates it: there is not one
 * `revalidateTag` or `revalidatePath` in `src/`. A closure an owner had just saved kept
 * selling for up to `s-maxage + stale-while-revalidate` seconds at every edge location.
 *
 * This also protects the resolver programme's own safety net. Stages 3 and 5 change
 * precisely the values these routes returned, so with caching in place a staging soak
 * would look correct while production served pre-change availability.
 *
 * The restaurant table path is deliberately exempt: it is out of scope for the resolver
 * work (plan §8) and is left exactly as it is.
 */

const API = join(process.cwd(), 'src', 'app', 'api', 'booking');

const SCHEDULE_ROUTES = [
  'appointment-calendar/route.ts',
  'class-instances/route.ts',
  'resource-calendar/route.ts',
  'unified-availability/route.ts',
];

/** Restaurant-only, explicitly out of scope. Listed so the exemption is deliberate. */
const EXEMPT = ['table-calendar/route.ts'];

function read(relative: string): string {
  return readFileSync(join(API, relative), 'utf8');
}

describe('schedule-derived routes are never CDN-cached (SA-M9)', () => {
  it.each(SCHEDULE_ROUTES)('%s sets no s-maxage', (route) => {
    expect(read(route)).not.toMatch(/'Cache-Control':\s*'public,\s*s-maxage/);
  });

  it.each(SCHEDULE_ROUTES.filter((r) => r !== 'unified-availability/route.ts'))(
    '%s sets no-store on its response',
    (route) => {
      expect(read(route)).toContain("'Cache-Control': 'no-store'");
    },
  );

  it('leaves the restaurant table route alone, which §8 puts out of scope', () => {
    expect(read(EXEMPT[0]!)).toMatch(/s-maxage/);
  });
});
