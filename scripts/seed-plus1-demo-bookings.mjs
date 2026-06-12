/**
 * One-off seed: 100 demo bookings for the "Plus 1" venue (unified_scheduling)
 * on the staging project (zkppmyyvkjvbsvemakbb), spread over the next 2 weeks.
 *
 * - Fake guests, emails @resneotest.com, NO phone numbers (left blank).
 * - Variety of services across the Andrew + David calendars.
 * - Avoids overlapping existing bookings on the same calendar.
 *
 * Safety: requires ALLOW_SEED=1.
 *   ALLOW_SEED=1 node scripts/seed-plus1-demo-bookings.mjs
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

const rootDir = dirname(fileURLToPath(import.meta.url));
config({ path: join(rootDir, '..', '.env.local') });

if (process.env.ALLOW_SEED !== '1') {
  console.error('Refusing to run: set ALLOW_SEED=1 to confirm .env.local targets the intended project.');
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(url, key, { auth: { persistSession: false } });

const VENUE_ID = 'c6eb0e01-ae6b-4842-80f7-002619b1f4b5';
const STAFF_ID = '23a87738-cdf7-4ca1-84ec-d969d98191b7'; // plus1 admin
const TARGET = Number(process.env.SEED_COUNT ?? 100);
const EMAIL_DOMAIN = 'resneotest.com';

// Calendars that are bookable (have service assignments + daily hours). Room 1 excluded.
const CALENDARS = [
  '6f5ee50f-14d4-41e9-9503-e669f816a606', // Andrew
  '39ed91a4-53a5-4f72-b64b-07d80fd4cb06', // David
];

// Date window: the next 2 weeks, starting tomorrow (today is 2026-06-11).
const DATES = [];
{
  const start = new Date(Date.UTC(2026, 5, 12)); // 2026-06-12
  for (let i = 0; i < 14; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    DATES.push(d.toISOString().slice(0, 10));
  }
}

const DAY_OPEN_MIN = 9 * 60;   // 09:00
const DAY_CLOSE_MIN = 22 * 60; // 22:00
const SLOT = 15;               // align starts to 15-min grid

const FIRST_NAMES = ['Olivia','Liam','Emma','Noah','Ava','Oliver','Sophia','Jack','Isla','Charlie','Mia','Harry','Grace','George','Lily','Leo','Freya','Oscar','Ella','Arthur','Ruby','Henry','Evie','Theo','Chloe','Finn','Maeve','Jacob','Niamh','Daniel','Aoife','Adam','Sophie','Conor','Hannah','Ryan','Erin','Sean','Katie','Cian','Megan','Patrick','Sarah','James','Laura','Mark','Rachel','Kevin','Emily','Aaron'];
const LAST_NAMES = ['Smith','Johnston','Wilson','Doherty','Campbell','Murphy','Kelly','Brown','Thompson','Quinn','Robinson','ONeill','Stewart','Reid','Scott','Walker','Hughes','Bell','Gallagher','Boyd','Graham','Hamilton','Patterson','Moore','Anderson','Martin','McLaughlin','Magee','Lyons','Friel','Burns','Black','Clarke','Donnelly','Hill','Hunter','Irvine','Jamison','Kennedy','Lennon','Maguire','Nelson','OBrien','Park','Rooney','Sloan','Todd','Vance','Wallace','Young'];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function shuffle(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }
function pad(n) { return String(n).padStart(2, '0'); }
function minToTime(m) { return `${pad(Math.floor(m / 60))}:${pad(m % 60)}:00`; }

async function main() {
  // Load active service items + their durations.
  const { data: services, error: svcErr } = await admin
    .from('service_items')
    .select('id, name, duration_minutes, price_pence, is_active')
    .eq('venue_id', VENUE_ID)
    .eq('is_active', true);
  if (svcErr || !services?.length) { console.error('No services', svcErr); process.exit(1); }
  console.log(`Loaded ${services.length} active services.`);

  // Build per-(calendar,date) busy intervals from existing bookings in window.
  const busy = new Map(); // key `${cal}|${date}` -> [[startMin,endMin],...]
  const keyOf = (cal, date) => `${cal}|${date}`;
  const addBusy = (cal, date, s, e) => { const k = keyOf(cal, date); if (!busy.has(k)) busy.set(k, []); busy.get(k).push([s, e]); };

  const { data: existing } = await admin
    .from('bookings')
    .select('booking_date, booking_time, estimated_end_time, calendar_id, status')
    .eq('venue_id', VENUE_ID)
    .gte('booking_date', DATES[0])
    .lte('booking_date', DATES[DATES.length - 1]);
  for (const b of existing ?? []) {
    if (!b.calendar_id || ['Cancelled', 'No-Show'].includes(b.status)) continue;
    const [sh, sm] = b.booking_time.split(':').map(Number);
    const startMin = sh * 60 + sm;
    let endMin = startMin + 30;
    if (b.estimated_end_time) {
      const d = new Date(b.estimated_end_time); // stored as wall-clock @ +00:00
      endMin = d.getUTCHours() * 60 + d.getUTCMinutes();
      if (endMin <= startMin) endMin = startMin + 30;
    }
    addBusy(b.calendar_id, b.booking_date, startMin, endMin);
  }
  console.log(`Seeded ${existing?.length ?? 0} existing bookings as busy intervals.`);

  const overlaps = (cal, date, s, e) => {
    const arr = busy.get(keyOf(cal, date)) ?? [];
    return arr.some(([bs, be]) => s < be && e > bs);
  };

  // Try to place one booking: random calendar/date/service/start without overlap.
  function tryPlace() {
    for (let attempt = 0; attempt < 80; attempt++) {
      const cal = pick(CALENDARS);
      const date = pick(DATES);
      const svc = pick(services);
      const dur = svc.duration_minutes || 30;
      const latestStart = DAY_CLOSE_MIN - dur;
      if (latestStart < DAY_OPEN_MIN) continue;
      const slots = Math.floor((latestStart - DAY_OPEN_MIN) / SLOT) + 1;
      const startMin = DAY_OPEN_MIN + Math.floor(Math.random() * slots) * SLOT;
      const endMin = startMin + dur;
      if (overlaps(cal, date, startMin, endMin)) continue;
      addBusy(cal, date, startMin, endMin);
      return { cal, date, svc, dur, startMin, endMin };
    }
    return null;
  }

  const usedEmails = new Set();
  function makeGuest() {
    const first = pick(FIRST_NAMES);
    const last = pick(LAST_NAMES);
    let email;
    for (let i = 0; i < 1000; i++) {
      const n = Math.floor(100 + Math.random() * 9900);
      const candidate = `${first}.${last}.${n}`.toLowerCase().replace(/[^a-z0-9.]/g, '') + `@${EMAIL_DOMAIN}`;
      if (!usedEmails.has(candidate)) { usedEmails.add(candidate); email = candidate; break; }
    }
    return { first, last, email };
  }

  const SOURCES = ['online', 'online', 'online', 'booking_page', 'booking_page', 'phone'];
  const created = [];

  for (let i = 0; i < TARGET; i++) {
    const placement = tryPlace();
    if (!placement) { console.warn(`Could not place booking ${i + 1} after retries; stopping early.`); break; }
    const { cal, date, svc, dur, startMin } = placement;
    const bookingTime = minToTime(startMin);

    // Guest
    const g = makeGuest();
    const { data: guest, error: gErr } = await admin
      .from('guests')
      .insert({
        venue_id: VENUE_ID,
        first_name: g.first,
        last_name: g.last,
        email: g.email,
        phone: null,
        source: 'seed_demo',
        custom_fields: { seed_demo: true },
      })
      .select('id, first_name, last_name, email')
      .single();
    if (gErr || !guest) { console.error('Guest insert failed', gErr); process.exit(1); }

    // estimated_end_time: wall-clock components treated as UTC (matches existing rows)
    const [y, mo, d] = date.split('-').map(Number);
    const endDate = new Date(Date.UTC(y, mo - 1, d, Math.floor(startMin / 60), startMin % 60, 0));
    endDate.setUTCMinutes(endDate.getUTCMinutes() + dur);
    const estimatedEndTime = endDate.toISOString();

    // cancellation deadline: 48h before start
    const startDate = new Date(Date.UTC(y, mo - 1, d, Math.floor(startMin / 60), startMin % 60, 0));
    const cancelDeadline = new Date(startDate);
    cancelDeadline.setUTCHours(cancelDeadline.getUTCHours() - 48);

    const source = pick(SOURCES);
    const status = Math.random() < 0.75 ? 'Booked' : 'Confirmed';

    const insert = {
      venue_id: VENUE_ID,
      guest_id: guest.id,
      booking_date: date,
      booking_time: bookingTime,
      party_size: 1,
      status,
      source,
      created_by_staff_id: source === 'phone' ? STAFF_ID : null,
      deposit_status: 'Not Required',
      cancellation_deadline: cancelDeadline.toISOString(),
      cancellation_policy_snapshot: {
        policy: 'Full refund if cancelled 48+ hours before your booking start time. No refund within 48 hours of the start or for no-shows.',
        refund_window_hours: 48,
      },
      estimated_end_time: estimatedEndTime,
      guest_email: g.email,
      guest_first_name: guest.first_name,
      guest_last_name: guest.last_name,
      guest_phone: null,
      calendar_id: cal,
      service_item_id: svc.id,
      capacity_used: 1,
      booking_model: 'unified_scheduling',
      location_type: 'business_venue',
      addons_total_price_pence: 0,
      addons_total_duration_minutes: 0,
      suppress_import_comms: true,
    };

    const { data: booking, error: bErr } = await admin
      .from('bookings')
      .insert(insert)
      .select('id')
      .single();
    if (bErr || !booking) { console.error('Booking insert failed', bErr, insert); process.exit(1); }

    created.push({ booking_id: booking.id, guest_id: guest.id, date, time: bookingTime, service: svc.name, calendar: cal === CALENDARS[0] ? 'Andrew' : 'David', status, source });
    if ((i + 1) % 10 === 0) console.log(`  ...${i + 1} created`);
  }

  writeFileSync(join(rootDir, 'seed-plus1-demo-output.json'), JSON.stringify(created, null, 2));
  console.log(`\nDone. Created ${created.length} bookings (+ ${created.length} guests).`);

  // Summary
  const byService = {};
  const byCal = {};
  const byDate = {};
  for (const c of created) {
    byService[c.service] = (byService[c.service] ?? 0) + 1;
    byCal[c.calendar] = (byCal[c.calendar] ?? 0) + 1;
    byDate[c.date] = (byDate[c.date] ?? 0) + 1;
  }
  console.log('\nBy service:'); for (const [k, v] of Object.entries(byService).sort((a, b) => b[1] - a[1])) console.log(`  ${v.toString().padStart(3)}  ${k}`);
  console.log('\nBy calendar:', JSON.stringify(byCal));
  console.log('By date:'); for (const k of Object.keys(byDate).sort()) console.log(`  ${k}: ${byDate[k]}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
