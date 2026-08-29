/**
 * What a route's INITIAL client bundle contains (P2-5a).
 *
 * Next 16 writes no `app-build-manifest.json`, so the source of truth is the
 * per-route `page_client-reference-manifest.js`: it lists every client chunk
 * the route pulls in eagerly. A `dynamic()` import is NOT in there, which is
 * exactly the difference this measures.
 *
 * Sizes alone could not answer "is the booking flow in here": a chunk can grow
 * or shrink for unrelated reasons. The MARKER is the answer; the bytes are the
 * cost.
 *
 * Usage, after a build into a scratch dist so a running dev server is left
 * alone:
 *
 *   NEXT_DIST_DIR=.next-measure npx next build
 *   npm run measure:route-bundle -- .next-measure
 *
 * P2-5a's numbers, 2026-08-29. Before: the token manage page shipped 1,331 KB
 * and contained the booking flow AND Stripe. After: 648 KB and neither. The
 * public booking page is the CONTROL and did not move, because it already
 * mounted the same component lazily.
 */
import fs from 'node:fs';
import path from 'node:path';

const dist = process.argv[2] ?? '.next-measure';

const ROUTES = [
  ['token manage page', 'manage/[bookingId]/[token]'],
  ['token short-link page', 'manage/[bookingId]'],
  ['portal booking detail', 'account/bookings/[bookingId]'],
  ['public booking page', 'book/[venue-slug]'],
];

const MARKERS = {
  stripe: ['js.stripe.com', 'loadStripe'],
  // Unique to AppointmentBookingFlow. `ap-time-slot` was tried first and is
  // WRONG: it lives in the shared `appointment-public-ui` module, so it
  // reported the flow present on pages that only use the shared styles.
  bookingFlow: ['Save appointment changes'],
};

/*
  The control. After P2-5a the flow must be ABSENT from the routes above and
  still PRESENT somewhere in the build: a change that simply stopped shipping
  it would pass an absence check and break every reschedule.
*/
const allChunks = fs
  .readdirSync(path.join(dist, 'static/chunks'), { withFileTypes: true })
  .filter((e) => e.isFile() && e.name.endsWith('.js'))
  .map((e) => path.join(dist, 'static/chunks', e.name));
const flowChunks = allChunks.filter((f) =>
  MARKERS.bookingFlow.some((n) => fs.readFileSync(f, 'utf8').includes(n)),
);
console.log(`booking flow lives in ${flowChunks.length} chunk(s) of ${allChunks.length}
`);

for (const [label, route] of ROUTES) {
  const manifestPath = path.join(dist, 'server/app', route, 'page_client-reference-manifest.js');
  if (!fs.existsSync(manifestPath)) {
    console.log(`${label.padEnd(24)} (no manifest at ${route})`);
    continue;
  }
  const src = fs.readFileSync(manifestPath, 'utf8');
  // Chunk paths appear as "static/chunks/....js" throughout the manifest.
  const chunks = [...new Set([...src.matchAll(/static\/chunks\/[^"']+?\.js/g)].map((m) => m[0]))];

  let bytes = 0;
  const found = new Set();
  for (const chunk of chunks) {
    const full = path.join(dist, chunk);
    if (!fs.existsSync(full)) continue;
    bytes += fs.statSync(full).size;
    const code = fs.readFileSync(full, 'utf8');
    for (const [name, needles] of Object.entries(MARKERS)) {
      if (needles.some((needle) => code.includes(needle))) found.add(name);
    }
  }
  console.log(
    `${label.padEnd(24)} chunks ${String(chunks.length).padStart(3)}  ` +
      `${String((bytes / 1024).toFixed(0)).padStart(5)} KB  contains: ` +
      (found.size ? [...found].sort().join(' + ') : 'neither'),
  );
}
