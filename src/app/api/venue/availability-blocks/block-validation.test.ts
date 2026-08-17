import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Stage 1 item 3 (plan §1.2 item 13): the PATCH route validates the row it will actually
 * write, not merely the fields the patch happens to carry.
 *
 * `blockPatchSchema` is a genuine partial-update schema, so porting the POST refine onto it
 * would break a normal `{id, date_end}` patch, which has no `block_type` to test. The fix
 * merges the patch onto the stored row and validates the result. Three further holes on the
 * same route are closed alongside it: neither schema checked `date_end >= date_start` or
 * `time_end > time_start`, DELETE took `body.id` raw, and a missing stored row skipped the
 * conflict guard and fell through to an update that matched nothing.
 *
 * These assertions read the route source. The handler needs a Supabase admin client and a
 * NextRequest to run, and the house pattern for this route is no test at all; asserting the
 * shape is what is available without standing up both, and it fails if any of the four
 * regressions is reintroduced.
 */

const ROUTE = join(process.cwd(), 'src', 'app', 'api', 'venue', 'availability-blocks', 'route.ts');
const source = readFileSync(ROUTE, 'utf8');

describe('availability-blocks validation (SA-M19 / plan §1.2 item 13)', () => {
  it('has one ordering rule, shared by both verbs', () => {
    expect(source).toContain('function blockOrderingError');
    // Both schemas run it, so POST and PATCH cannot drift apart again.
    expect(source.match(/blockOrderingError\(v\)/g)?.length).toBe(2);
  });

  it('rejects an inverted date range and an inverted time window', () => {
    expect(source).toContain('The end date cannot be before the start date.');
    expect(source).toContain('The end time must be after the start time.');
  });

  it('refuses amended_hours with no periods on the MERGED row, not just on create', () => {
    expect(source).toContain('At least one open period is required for amended hours.');
    expect(source).toContain('const orderingError = blockOrderingError(merged);');
    // The merge has to see the stored periods, or an amended_hours patch that touches
    // only the dates would be judged against an absent override_periods.
    expect(source).toMatch(/\.select\('block_type, date_start, date_end, time_start, time_end, override_periods'\)/);
  });

  it('keeps the patch schema partial rather than inheriting the POST refine', () => {
    expect(source).toContain('const blockPatchSchema = z');
    expect(source).toContain('id: z.string().uuid()');
    // date_start/date_end stay optional on PATCH; only POST requires them.
    expect(source).toMatch(/date_start: z\.string\(\)\.regex\(\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\)\.optional\(\)/);
  });

  it('answers 404 for a missing row instead of falling through to the update', () => {
    expect(source).toContain("return NextResponse.json({ error: 'Block not found' }, { status: 404 });");
    expect(source).not.toContain('if (existing) {');
  });

  it('parses a schema on DELETE rather than trusting body.id', () => {
    expect(source).toContain('const blockDeleteSchema = z.object({ id: z.string().uuid() });');
    expect(source).toContain('blockDeleteSchema.safeParse(body)');
    expect(source).not.toContain("if (!body.id) return NextResponse.json({ error: 'Missing id' }");
  });

  it('runs the conflict guard unconditionally once the row is known to exist', () => {
    const patchBody = source.slice(source.indexOf('export async function PATCH'));
    const guardIndex = patchBody.indexOf('guardVenueClosureConflicts');
    const notFoundIndex = patchBody.indexOf("status: 404");

    expect(notFoundIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeGreaterThan(notFoundIndex);
  });
});
