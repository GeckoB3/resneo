/**
 * Seed the portal e2e customer: one auth user with guest rows and bookings at BOTH
 * fixture venues (P0-1b of Docs/Resneo_Customer_Portal_World_Class_Plan.md).
 *
 * Cross-venue identity is the portal's distinguishing behaviour, so a single-venue
 * fixture would not catch a regression in it. This is a sibling of
 * `scripts/seed-e2e-smoke-venue.mjs` rather than an extension: that script owns the
 * venues and their catalogue, this one owns one customer and their bookings, and it
 * REQUIRES the venue seeder to have run first.
 *
 * Idempotent, and its own teardown: every run deletes the customer's bookings and
 * re-inserts the deterministic set below, so specs can assert exact bookings without
 * runs polluting each other. The auth user and guest rows persist across runs, like
 * the fixture venues do.
 *
 * Deterministic bookings per venue (times chosen away from the smoke specs' bookings,
 * which book real slots through the UI on the same venues):
 *   - one upcoming (7 days from now, 09:00) with status Booked
 *   - one past (7 days ago, 09:00) with status Completed
 *
 * Usage:
 *   node scripts/seed-e2e-portal-customer.mjs
 *
 * Requires .env.local / env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY.
 * Optional: E2E_PORTAL_CUSTOMER_EMAIL, E2E_VENUE_SLUG, E2E_STAFF_FIRST_VENUE_SLUG,
 * E2E_SERVICE_NAME, E2E_STAFF_FIRST_SHARED_SERVICE_NAME (defaults match the venue seeder).
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env.local') });
config({ path: join(__dirname, '..', '.env.e2e') });

const CUSTOMER_EMAIL =
  process.env.E2E_PORTAL_CUSTOMER_EMAIL?.trim() || 'e2e-portal-customer@resneo-e2e.invalid';
const CUSTOMER_FIRST_NAME = 'Portia';
const CUSTOMER_LAST_NAME = 'E2E-Customer';
const CUSTOMER_PHONE = '+442071234568';

/** venue slug -> service to book there (must exist; the venue seeder creates both). */
const VENUES = [
  {
    slug: process.env.E2E_VENUE_SLUG?.trim() || 'e2e-smoke-appointments',
    serviceName: process.env.E2E_SERVICE_NAME?.trim() || 'E2E Smoke Consultation',
  },
  {
    slug: process.env.E2E_STAFF_FIRST_VENUE_SLUG?.trim() || 'e2e-smoke-staff-first',
    serviceName:
      process.env.E2E_STAFF_FIRST_SHARED_SERVICE_NAME?.trim() || 'E2E Shared Consultation',
  },
];

function makeAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !serviceKey) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY');
    process.exit(1);
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Create-or-fetch the customer auth user. Created confirmed: `claim_user_account()`
 * only links guest rows for a session whose owner has a confirmed email, and the
 * sign-in helper's token_hash verification depends on the user existing.
 */
async function ensureAuthUser(admin) {
  const { data: created, error } = await admin.auth.admin.createUser({
    email: CUSTOMER_EMAIL,
    email_confirm: true,
    user_metadata: { e2e_portal_fixture: true },
  });
  if (!error) {
    console.log('[portal-seed] Created auth user:', created.user.id, CUSTOMER_EMAIL);
    return created.user.id;
  }

  // Already exists: find it. listUsers has no email filter on this SDK version, so page.
  for (let page = 1; page <= 20; page++) {
    const { data, error: listErr } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (listErr) throw new Error(`listUsers: ${listErr.message}`);
    const hit = data.users.find((u) => u.email?.toLowerCase() === CUSTOMER_EMAIL.toLowerCase());
    if (hit) {
      console.log('[portal-seed] Reusing auth user:', hit.id, CUSTOMER_EMAIL);
      return hit.id;
    }
    if (data.users.length < 200) break;
  }
  throw new Error(`createUser failed (${error.message}) and user not found by listing`);
}

/** Create-or-update the guest row at one venue, linked to the auth user. */
async function ensureGuest(admin, venueId, userId) {
  const { data: existing } = await admin
    .from('guests')
    .select('id')
    .eq('venue_id', venueId)
    .eq('email', CUSTOMER_EMAIL)
    .maybeSingle();

  const fields = {
    venue_id: venueId,
    email: CUSTOMER_EMAIL,
    phone: CUSTOMER_PHONE,
    first_name: CUSTOMER_FIRST_NAME,
    last_name: CUSTOMER_LAST_NAME,
    user_id: userId,
    // Deliberately NOT consented: the fixture must never look like a marketing opt-in,
    // and a spec asserting consent state needs a known-false baseline.
    marketing_consent: false,
    marketing_opt_out: false,
    source: 'self_booked',
  };

  if (existing?.id) {
    const { error } = await admin.from('guests').update(fields).eq('id', existing.id);
    if (error) throw new Error(`guest update: ${error.message}`);
    return existing.id;
  }
  const { data, error } = await admin.from('guests').insert(fields).select('id').single();
  if (error) throw new Error(`guest insert: ${error.message}`);
  console.log('[portal-seed] Created guest:', data.id, 'at venue', venueId);
  return data.id;
}

function ymd(d) {
  return d.toISOString().slice(0, 10);
}

/**
 * Wipe and re-insert this guest's bookings at one venue. Times are direct inserts,
 * not slot-engine picks: these rows exist for the portal to LIST, and 09:00 is
 * inside the fixture calendars' Mon-Fri hours without competing with the smoke
 * specs, which book real availability through the UI from 09:15 onward.
 */
async function resetBookings(admin, { venueId, guestId, calendarId, serviceItemId, serviceName }) {
  const del = await admin.from('bookings').delete().eq('guest_id', guestId).eq('venue_id', venueId);
  if (del.error) throw new Error(`bookings delete: ${del.error.message}`);

  const now = new Date();
  const upcoming = new Date(now.getTime() + 7 * 86400_000);
  const past = new Date(now.getTime() - 7 * 86400_000);

  const base = {
    venue_id: venueId,
    guest_id: guestId,
    party_size: 1,
    booking_model: 'unified_scheduling',
    calendar_id: calendarId,
    service_item_id: serviceItemId,
    booking_time: '09:00:00',
    booking_end_time: '09:30:00',
    source: 'booking_page',
    guest_email: CUSTOMER_EMAIL,
    guest_first_name: CUSTOMER_FIRST_NAME,
    guest_last_name: CUSTOMER_LAST_NAME,
    guest_phone: CUSTOMER_PHONE,
    service_name_snapshot: serviceName,
  };

  const rows = [
    { ...base, booking_date: ymd(upcoming), status: 'Booked' },
    { ...base, booking_date: ymd(past), status: 'Completed' },
  ];
  const { data, error } = await admin.from('bookings').insert(rows).select('id, booking_date, status');
  if (error) throw new Error(`bookings insert: ${error.message}`);
  for (const b of data) console.log('[portal-seed] Booking:', b.id, b.booking_date, b.status);
}

async function main() {
  const admin = makeAdmin();
  const userId = await ensureAuthUser(admin);

  for (const { slug, serviceName } of VENUES) {
    const { data: venue, error: vErr } = await admin
      .from('venues')
      .select('id, name')
      .eq('slug', slug)
      .maybeSingle();
    if (vErr) throw new Error(`venue lookup ${slug}: ${vErr.message}`);
    if (!venue) {
      throw new Error(
        `Fixture venue "${slug}" not found. Run scripts/seed-e2e-smoke-venue.mjs first.`,
      );
    }

    const { data: service, error: sErr } = await admin
      .from('service_items')
      .select('id')
      .eq('venue_id', venue.id)
      .eq('name', serviceName)
      .maybeSingle();
    if (sErr || !service) {
      throw new Error(`Service "${serviceName}" not found at ${slug}. Re-run the venue seeder.`);
    }

    const { data: calendar, error: cErr } = await admin
      .from('unified_calendars')
      .select('id')
      .eq('venue_id', venue.id)
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (cErr || !calendar) throw new Error(`No active calendar at ${slug}`);

    const guestId = await ensureGuest(admin, venue.id, userId);
    await resetBookings(admin, {
      venueId: venue.id,
      guestId,
      calendarId: calendar.id,
      serviceItemId: service.id,
      serviceName,
    });
    console.log(`[portal-seed] ${venue.name} (${slug}): guest ${guestId} ready`);
  }

  console.log('\n[portal-seed] Done. Add to .env.e2e / CI variables:\n');
  console.log(`E2E_PORTAL_CUSTOMER_EMAIL=${CUSTOMER_EMAIL}`);
}

main().catch((err) => {
  console.error('[portal-seed] Failed:', err.message ?? err);
  process.exit(1);
});
