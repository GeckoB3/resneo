/**
 * Measures what an appointment capacity guard (P2-3a) would do to real data,
 * BEFORE the guard is written.
 *
 * WHY THIS EXISTS. `enforce_cde_capacity` covers class, event and resource
 * bookings and explicitly excludes appointments, so two concurrent reschedules
 * can double-book an appointment slot. The obvious fix is to copy that
 * function's RESOURCE branch, which rejects any overlapping active booking on
 * the same calendar. Applied to appointments that is wrong twice over, and
 * both mistakes are silent:
 *
 *   1. `unified_calendars.parallel_clients` caps how many clients a calendar
 *      handles SIMULTANEOUSLY (`appointment-engine.ts:324,381,637`). A venue
 *      running two chairs off one calendar legitimately has overlapping
 *      appointments. A no-overlap guard rejects bookings the availability
 *      engine correctly offers.
 *
 *   2. A booking's busy time is NOT one contiguous span. `processing_time_blocks`
 *      splits it: during a hair colour's processing gap the chair is free and
 *      the engine will book another client into it
 *      (`appointment-engine.ts:307-318`). A guard reading only
 *      `booking_time`..`booking_end_time` treats that gap as busy and is
 *      therefore STRICTER than the engine, rejecting bookings the engine offers.
 *
 * A trigger fires on UPDATE as well as INSERT, so any existing row that already
 * violates whatever rule the guard applies would be refused a RESCHEDULE. That
 * turns the guard into an incident rather than a fix, and it is the thing this
 * script is really here to count.
 *
 * WHAT IT DOES NOT DO. It writes nothing and it decides nothing. It reports
 * four numbers so P2-3a can be designed against real configurations instead of
 * against the column defaults.
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY, from the
 * environment or .env.local.
 *
 * Usage:
 *   npm run measure:appointment-concurrency
 *   node scripts/measure-appointment-concurrency.mjs
 *   node scripts/measure-appointment-concurrency.mjs --since 2026-01-01
 */

import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env.local') });

/** Statuses that occupy a slot, matching `enforce_cde_capacity`'s own list. */
const ACTIVE_STATUSES = ['Pending', 'Booked', 'Confirmed', 'Seated'];

const PAGE = 1000;

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function requireEnv(name) {
  const v = process.env[name]?.trim();
  if (!v) {
    console.error(`Missing ${name}. Set it in the environment or .env.local.`);
    process.exit(2);
  }
  return v;
}

/** Read a table in pages, because these can be large and a silent cap would lie. */
async function readAll(db, table, columns, apply) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    let q = db.from(table).select(columns).range(from, from + PAGE - 1);
    if (apply) q = apply(q);
    const { data, error } = await q;
    if (error) {
      console.error(`Reading ${table} failed: ${error.message}`);
      process.exit(1);
    }
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

const toMinutes = (t) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t ?? '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** Blocks whose shape this script did not recognise, so it cannot report zero silently. */
const unreadableBlocks = [];

/**
 * The busy intervals a booking really occupies.
 *
 * With processing blocks the span is split, which is the whole point: a guard
 * that ignores them is stricter than the engine.
 *
 * The shape is `{ id, start_minute, duration_minutes }`, mirroring
 * `practitionerBusyMinuteOffsets` (`src/lib/appointments/processing-time.ts:173`),
 * where `start_minute` is an offset from the booking start. It is reimplemented
 * here rather than imported because this is a plain `.mjs` script and that
 * module is TypeScript. A shape this does not recognise is COLLECTED rather
 * than skipped: a measurement script that silently reports zero is worse than
 * no measurement, and an earlier draft of this function guessed the field names
 * wrong and would have done exactly that.
 */
function busyIntervals(row) {
  const start = toMinutes(row.booking_time);
  const end = toMinutes(row.booking_end_time);
  if (start == null || end == null || end <= start) return [];

  const blocks = Array.isArray(row.processing_time_blocks) ? row.processing_time_blocks : [];
  const gaps = [];
  for (const b of blocks) {
    const from = Number(b?.start_minute);
    const length = Number(b?.duration_minutes);
    if (!Number.isFinite(from) || !Number.isFinite(length) || length <= 0) {
      unreadableBlocks.push({ bookingId: row.id, block: b });
      continue;
    }
    gaps.push({ start: start + from, end: start + from + length });
  }
  gaps.sort((a, b) => a.start - b.start);

  if (gaps.length === 0) return [{ start, end }];

  const busy = [];
  let cursor = start;
  for (const gap of gaps) {
    if (gap.start > cursor) busy.push({ start: cursor, end: Math.min(gap.start, end) });
    cursor = Math.max(cursor, gap.end);
  }
  if (cursor < end) busy.push({ start: cursor, end });
  return busy.filter((b) => b.end > b.start);
}

/**
 * True when a processing gap falls inside the booking's window.
 *
 * "Has a gap inside its window", not "produces more than one busy interval".
 * The narrower reading was the first version of this and it UNDER-COUNTED: a
 * gap running to the END of the span leaves one busy interval, so it was not
 * counted, even though the engine can still book into that gap and a
 * span-based guard is still stricter than the engine for it. The SQL sibling
 * caught the disagreement, at 9 against 7 on the same database, which is the
 * argument for having written both.
 */
function hasGapInWindow(row) {
  const start = toMinutes(row.booking_time);
  const end = toMinutes(row.booking_end_time);
  if (start == null || end == null || end <= start) return false;
  const blocks = Array.isArray(row.processing_time_blocks) ? row.processing_time_blocks : [];
  return blocks.some((b) => {
    const from = Number(b?.start_minute);
    const length = Number(b?.duration_minutes);
    if (!Number.isFinite(from) || !Number.isFinite(length) || length <= 0) return false;
    return start + from > start && start + from < end;
  });
}

/** Peak simultaneous bookings in a group, by sweeping interval endpoints. */
function peakConcurrency(rows) {
  const events = [];
  for (const row of rows) {
    for (const b of busyIntervals(row)) {
      events.push([b.start, 1], [b.end, -1]);
    }
  }
  // Ends before starts at the same minute: back-to-back bookings do not overlap.
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let now = 0;
  let peak = 0;
  for (const [, delta] of events) {
    now += delta;
    if (now > peak) peak = now;
  }
  return peak;
}

function groupBy(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const k = key(row);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(row);
  }
  return map;
}

async function main() {
  const url = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  const secret = requireEnv('SUPABASE_SECRET_KEY');
  const since = arg('since', '1900-01-01');
  const db = createClient(url, secret, { auth: { persistSession: false } });

  console.log(`Database: ${url}`);
  console.log(`Active statuses: ${ACTIVE_STATUSES.join(', ')}`);
  console.log(`Bookings from: ${since}\n`);

  const calendars = await readAll(db, 'unified_calendars', 'id, venue_id, name, calendar_type, capacity, parallel_clients');
  const bookings = await readAll(
    db,
    'bookings',
    'id, venue_id, calendar_id, practitioner_id, appointment_service_id, booking_date, booking_time, booking_end_time, status, processing_time_blocks',
    (q) => q.in('status', ACTIVE_STATUSES).gte('booking_date', since).not('calendar_id', 'is', null),
  );

  const calById = new Map(calendars.map((c) => [c.id, c]));
  const capOf = (id) => Math.max(1, Number(calById.get(id)?.parallel_clients ?? 1));

  // ── M1: do calendars above capacity 1 exist at all? ──────────────────────
  const wide = calendars.filter(
    (c) => Number(c.parallel_clients ?? 1) > 1 || Number(c.capacity ?? 1) > 1,
  );
  const wideVenues = new Set(wide.map((c) => c.venue_id));
  console.log('M1  Calendars that take more than one client at once');
  console.log(`    ${wide.length} of ${calendars.length} calendars, across ${wideVenues.size} venue(s).`);
  if (wide.length > 0) {
    for (const c of wide.slice(0, 10)) {
      console.log(`      - ${c.name} (${c.calendar_type}): parallel_clients=${c.parallel_clients}, capacity=${c.capacity}`);
    }
    if (wide.length > 10) console.log(`      ... and ${wide.length - 10} more`);
    console.log('    => A no-overlap guard would break these. The guard must count against parallel_clients.');
  } else {
    console.log('    => Every calendar is one-at-a-time, so a cap-aware guard and a no-overlap guard agree TODAY.');
    console.log('       The column still defaults to 1 rather than being fixed at it, so the guard should still read it.');
  }

  // ── M2: how many bookings have a split busy span? ────────────────────────
  /*
    The denominator is bookings with a USABLE window: one with no end time
    cannot be span-checked at all, so it is not part of the population a span
    guard would misjudge. The total is reported beside it, because 122 of 315
    active appointment bookings on staging carry no end time, which is worth
    knowing on its own.
  */
  const withWindow = bookings.filter((b) => {
    const start = toMinutes(b.booking_time);
    const end = toMinutes(b.booking_end_time);
    return start != null && end != null && end > start;
  });
  const split = withWindow.filter((b) => hasGapInWindow(b));
  const splitVenues = new Set(split.map((b) => b.venue_id));
  console.log('\nM2  Active bookings whose busy time is NOT one contiguous span');
  console.log(
    `    ${split.length} of ${withWindow.length} bookings with a usable window` +
      ` (of ${bookings.length} active), across ${splitVenues.size} venue(s).`,
  );
  console.log(
    split.length > 0
      ? '    => A guard reading booking_time..booking_end_time is STRICTER than the engine for these.'
      : '    => No processing blocks in use, so a span-based guard and an interval-based one agree today.',
  );
  if (unreadableBlocks.length > 0) {
    // Loud on purpose. If the stored shape has moved, M2 and M4 are both
    // understated and the number above cannot be trusted.
    console.log(`    !! ${unreadableBlocks.length} block(s) in an unrecognised shape; M2 and M4 UNDERSTATE.`);
    console.log(`       Sample: ${JSON.stringify(unreadableBlocks[0].block)}`);
    console.log('       Expected { start_minute, duration_minutes } per processing-time.ts:173.');
  }

  // ── M3 and M4: what would each candidate guard REFUSE on its next update? ─
  const byCalendarDay = groupBy(bookings, (b) => `${b.calendar_id}|${b.booking_date}`);

  const exactOffenders = [];
  const overlapOffenders = [];
  for (const [key, rows] of byCalendarDay) {
    const calendarId = key.split('|')[0];
    const cap = capOf(calendarId);

    // M3: the same start time, which is what the RACE actually produces. Two
    // clients confirming the same offered slot pick the same booking_time.
    for (const [, sameSlot] of groupBy(rows, (r) => String(r.booking_time).slice(0, 5))) {
      if (sameSlot.length > cap) {
        exactOffenders.push({ key, cap, count: sameSlot.length, ids: sameSlot.map((r) => r.id) });
      }
    }

    // M4: peak concurrency, which is the ENGINE's rule.
    const peak = peakConcurrency(rows);
    if (peak > cap) overlapOffenders.push({ key, cap, peak, count: rows.length });
  }

  console.log('\nM3  Existing rows an EXACT-SLOT guard would refuse a reschedule');
  console.log(`    ${exactOffenders.length} calendar-day(s) already over cap at one start time.`);
  for (const o of exactOffenders.slice(0, 10)) {
    console.log(`      - ${o.key}: ${o.count} bookings at one time, cap ${o.cap}`);
  }
  if (exactOffenders.length > 10) console.log(`      ... and ${exactOffenders.length - 10} more`);

  console.log('\nM4  Existing rows a CONCURRENCY guard would refuse a reschedule');
  console.log(`    ${overlapOffenders.length} calendar-day(s) whose peak concurrency already exceeds cap.`);
  for (const o of overlapOffenders.slice(0, 10)) {
    console.log(`      - ${o.key}: peak ${o.peak}, cap ${o.cap}, ${o.count} bookings that day`);
  }
  if (overlapOffenders.length > 10) console.log(`      ... and ${overlapOffenders.length - 10} more`);

  // ── M5: is the legacy practitioner path actually empty? ──────────────────
  const legacy = await readAll(db, 'bookings', 'id', (q) =>
    q
      .in('status', ACTIVE_STATUSES)
      .gte('booking_date', since)
      .is('calendar_id', null)
      .not('practitioner_id', 'is', null),
  );
  console.log('\nM5  Active LEGACY appointment bookings (practitioner_id, no calendar_id)');
  console.log(`    ${legacy.length} booking(s).`);
  console.log(
    legacy.length === 0
      ? '    => The legacy path is empty, so the guard only needs to cover unified calendars.'
      : '    => The legacy path is NOT empty; the guard must cover practitioner_id too, and practitioners has no parallel_clients column.',
  );

  console.log('\nWhat these decide:');
  console.log('  M1 > 0            the guard MUST read parallel_clients, not assume 1.');
  console.log('  M2 > 0            a span-based guard is stricter than the engine; prefer exact-slot.');
  console.log('  M3 = 0            an exact-slot guard can ship without refusing an existing row.');
  console.log('  M4 > M3           the cost of the stricter design, in rows it would break.');
  console.log('\nNothing was written.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
