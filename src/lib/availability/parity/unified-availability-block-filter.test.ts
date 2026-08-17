import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * SA-M12 (plan §1.2 item 9): `getUnifiedAvailableSlots` queried only
 * `['closed', 'amended_hours']`, while every other venue-wide reader also treats
 * `special_event` as closure-like.
 *
 * That omission was worse than a missed closure. The result is passed on as a NON-NULL
 * array, so on a `special_event`-only date it passed `[]` and cleared the exception list
 * that `fetchCalendarAppointmentInput` had already resolved correctly from a query that
 * does include `special_event`. One bug firing twice.
 *
 * These assertions are on the source text rather than on behaviour, because the divergence
 * is between two SQL filters in different modules and there is no seam at which a fixture
 * can observe one without a live client. Comparing the filters directly is the honest test:
 * it fails the moment they drift apart again, which is the only thing worth protecting.
 */

const SRC = join(process.cwd(), 'src');

function readSource(relative: string): string {
  return readFileSync(join(SRC, relative), 'utf8');
}

/** All `.in('block_type', [...])` filters in a file, normalised to a sorted type list. */
function blockTypeFilters(source: string): string[][] {
  const out: string[][] = [];
  const re = /\.in\(\s*'block_type'\s*,\s*\[([^\]]*)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const types = m[1]!
      .split(',')
      .map((t) => t.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean)
      .sort();
    out.push(types);
  }
  return out;
}

const VENUE_WIDE_TYPES = ['amended_hours', 'closed', 'special_event'];

describe('venue-wide block_type filters agree across modules (SA-M12)', () => {
  it('unified-availability includes special_event', () => {
    const filters = blockTypeFilters(readSource('lib/unified-availability.ts'));

    expect(filters).toHaveLength(1);
    expect(filters[0]).toEqual(VENUE_WIDE_TYPES);
  });

  it('venue-wide-blocks-fetch, the canonical fetcher, uses the same three types', () => {
    const filters = blockTypeFilters(readSource('lib/availability/venue-wide-blocks-fetch.ts'));

    expect(filters.length).toBeGreaterThan(0);
    for (const f of filters) expect(f).toEqual(VENUE_WIDE_TYPES);
  });

  it('every venue-wide block_type filter in the codebase agrees', () => {
    const files = [
      'lib/unified-availability.ts',
      'lib/availability/venue-wide-blocks-fetch.ts',
      'lib/availability/appointment-engine.ts',
      'lib/availability/appointment-month-availability.ts',
    ];

    const disagreements = files.flatMap((f) =>
      blockTypeFilters(readSource(f))
        .filter((types) => types.includes('closed') && !types.includes('reduced_capacity'))
        .filter((types) => JSON.stringify(types) !== JSON.stringify(VENUE_WIDE_TYPES))
        .map((types) => ({ file: f, types })),
    );

    expect(disagreements).toEqual([]);
  });
});
