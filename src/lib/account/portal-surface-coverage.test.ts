/**
 * C1 (§5D.1), emptied by P5-1.
 *
 * A page that runs its own query is doing work no route can reuse, which means
 * the mobile app cannot reach the same answer without somebody reimplementing
 * it, and the two implementations then drift. Every portal page must go
 * through a `src/lib/account/*` loader that a route also calls.
 *
 * **The allowlist is empty and must stay that way.** It shipped with four
 * named surfaces that had no route: the events hub, the resources hub, the
 * profile's linked-venue relationships, and card-hold state on a booking.
 * P5-1 gave the first three routes and found the fourth already carried by
 * `booking-detail-dto`. Adding a name back here is a decision to publish a
 * surface the app cannot see.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const PAGES_DIR = path.join(ROOT, 'src', 'app', 'account');
const API_DIR = path.join(ROOT, 'src', 'app', 'api');
const LOADERS_DIR = path.join(ROOT, 'src', 'lib', 'account');

/**
 * Surfaces still allowed to query directly. Empty on purpose.
 *
 * If you are about to add one: the alternative is a loader in
 * `src/lib/account/` plus a route that calls it, which is the same work and
 * leaves the app able to show the same thing.
 */
const ALLOWLIST: string[] = [];

function walk(dir: string, match: (f: string) => boolean): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, match));
    else if (match(entry.name)) out.push(full);
  }
  return out;
}

const rel = (f: string) => path.relative(ROOT, f).replace(/\\/g, '/');

describe('C1: portal pages go through shared loaders', () => {
  const pages = walk(PAGES_DIR, (f) => f === 'page.tsx');

  it('finds pages to check, so this cannot pass vacuously', () => {
    expect(pages.length).toBeGreaterThan(3);
  });

  it('no page constructs an admin client or runs its own query', () => {
    /*
      Both patterns matter and for different reasons. `supabase.from(` is a
      page answering a question no route answers. `getSupabaseAdminClient(` is
      a page reaching for the service role, which is a privilege no page needs:
      loaders take an optional admin client and default it themselves, so the
      page never holds one.
    */
    const offenders = pages
      .filter((f) => {
        const src = fs.readFileSync(f, 'utf8');
        /*
          `getSupabaseAdminClient` WITHOUT the paren, so a page that merely
          imports the service role is caught too. Three pages were carrying
          exactly that after their queries moved into loaders: dead, harmless,
          and one keystroke from being a live call that this check would then
          be the last thing standing between. An import is the whole of the
          mistake worth catching, because nobody adds the call first.
        */
        return src.includes('getSupabaseAdminClient') || src.includes('supabase.from(');
      })
      .map(rel)
      .filter((f) => !ALLOWLIST.includes(f));

    expect(
      offenders,
      'a portal page queries directly; move it into src/lib/account and give it a route',
    ).toEqual([]);
  });

  it('keeps the allowlist empty, because P5-1 emptied it', () => {
    expect(ALLOWLIST).toEqual([]);
  });
});

describe('C1: every account loader is reachable through a route', () => {
  const loaderFiles = walk(LOADERS_DIR, (f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
  const apiSource = walk(API_DIR, (f) => f === 'route.ts')
    .map((f) => fs.readFileSync(f, 'utf8'))
    .join('\n');

  /** Every exported `load*` function, which is the shape a route consumes. */
  const loaders = [
    ...new Set(
      loaderFiles
        .flatMap((f) => [...fs.readFileSync(f, 'utf8').matchAll(/export async function (load[A-Za-z]+)/g)])
        .map((m) => m[1]),
    ),
  ];

  it('finds loaders to check', () => {
    expect(loaders.length).toBeGreaterThan(3);
  });

  for (const loader of loaders) {
    it(`${loader} is called by at least one route`, () => {
      /*
        A loader no route calls is a surface the app cannot see. This is the
        check that would have caught the events and resources hubs, which the
        pages called directly for months.
      */
      expect(
        apiSource.includes(loader),
        `${loader} has no route; add one under src/app/api or stop exporting it`,
      ).toBe(true);
    });
  }
});
