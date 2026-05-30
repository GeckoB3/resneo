/**
 * One-off: create test table bookings for a venue (staff lookup by email).
 *
 * Requires .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY
 * pointing at the target project (e.g. production).
 *
 * Safety: set ALLOW_LIVE_SEED=1 to run (avoids accidental execution).
 *
 * Usage:
 *   ALLOW_LIVE_SEED=1 npx tsx scripts/seed-live-test-bookings.ts
 *
 * Env overrides:
 *   STAFF_EMAIL=andrew@embersteakhouse.com (default)
 *   VENUE_ID=<uuid> — if set, skip staff email lookup; use first admin staff at venue for created_by_staff_id
 */

import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { normalizeToE164 } from '@/lib/phone/e164';

const rootDir = dirname(fileURLToPath(import.meta.url));
config({ path: join(rootDir, '..', '.env.local') });
config();

const STAFF_EMAIL = (process.env.STAFF_EMAIL ?? 'andrew@embersteakhouse.com').toLowerCase().trim();
const VENUE_ID_OVERRIDE = process.env.VENUE_ID?.trim() || null;

const DATES = {
  lunchDinnerDay: '2026-04-29',
  extraDay: '2026-05-01',
} as const;

function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

function randomPartySize(): number {
  return Math.floor(Math.random() * 6) + 1;
}

function randomUkE164(): string {
  let digits = '';
  for (let i = 0; i < 9; i++) {
    digits += String(Math.floor(Math.random() * 10));
  }
  const raw = `+447${digits}`;
  const e164 = normalizeToE164(raw, 'GB');
  if (!e164) throw new Error(`Failed to normalise phone ${raw}`);
  return e164;
}

function uniqueTestEmail(used: Set<string>): string {
  for (let attempt = 0; attempt < 500; attempt++) {
    const n = Math.floor(100 + Math.random() * 900);
    const addr = `test${n}@resneo.com`;
    if (!used.has(addr)) {
      used.add(addr);
      return addr;
    }
  }
  throw new Error('Could not allocate unique test email');
}

type VenueServiceRow = { id: string; name: string; sort_order: number | null };

function resolveLunchDinnerServices(services: VenueServiceRow[]): {
  lunchId: string;
  dinnerId: string;
  lunchName: string;
  dinnerName: string;
} {
  const sorted = [...services].sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name),
  );
  const byLunch = sorted.find((s) => /lunch/i.test(s.name));
  const byDinner = sorted.find((s) => /dinner|supper|evening/i.test(s.name));
  if (byLunch && byDinner) {
    return { lunchId: byLunch.id, dinnerId: byDinner.id, lunchName: byLunch.name, dinnerName: byDinner.name };
  }
  if (sorted.length >= 2) {
    const [a, b] = sorted;
    return { lunchId: a!.id, dinnerId: b!.id, lunchName: a!.name, dinnerName: b!.name };
  }
  throw new Error(
    `Need at least two active venue_services for lunch/dinner; got: ${sorted.map((s) => s.name).join(', ') || '(none)'}`,
  );
}

async function main() {
  if (process.env.ALLOW_LIVE_SEED !== '1') {
    console.error(
      'Refusing to run: set ALLOW_LIVE_SEED=1 after confirming .env.local points at the intended Supabase project.',
    );
    process.exit(1);
  }

  const [
    { getSupabaseAdminClient },
    { computeAvailability, fetchEngineInput },
    { findOrCreateGuest },
    { resolveVenueMode },
    { getDefaultAreaIdForVenue },
    { resolveDurationAndBufferForTableAssignment },
    { resolveCancellationNoticeHoursForCreate },
    { cancellationDeadlineHoursBefore },
    { autoAssignTable },
    { syncTableStatusesForBooking },
  ] = await Promise.all([
    import('@/lib/supabase'),
    import('@/lib/availability'),
    import('@/lib/guests'),
    import('@/lib/venue-mode'),
    import('@/lib/areas/resolve-default-area'),
    import('@/lib/table-management/booking-table-duration'),
    import('@/lib/booking/resolve-cancellation-notice-hours'),
    import('@/lib/booking/cancellation-deadline'),
    import('@/lib/table-availability'),
    import('@/lib/table-management/lifecycle'),
  ]);

  const admin = getSupabaseAdminClient();

  let venueId: string;
  let staff: { id: string; venue_id: string; email: string | null; name: string | null };

  if (VENUE_ID_OVERRIDE) {
    venueId = VENUE_ID_OVERRIDE;
    const { data: staffRow, error: sErr } = await admin
      .from('staff')
      .select('id, venue_id, email, name')
      .eq('venue_id', venueId)
      .eq('role', 'admin')
      .is('revoked_at', null)
      .limit(1)
      .maybeSingle();
    if (sErr || !staffRow) {
      const { data: anyStaff, error: aErr } = await admin
        .from('staff')
        .select('id, venue_id, email, name')
        .eq('venue_id', venueId)
        .is('revoked_at', null)
        .limit(1)
        .maybeSingle();
      if (aErr || !anyStaff) {
        console.error('No staff for VENUE_ID', venueId, aErr ?? sErr);
        process.exit(1);
      }
      staff = anyStaff as typeof staff;
    } else {
      staff = staffRow as typeof staff;
    }
    console.log(`Using VENUE_ID override; staff attribution: ${staff.email ?? staff.id}`);
  } else {
    let { data: staffRow, error: staffErr } = await admin
      .from('staff')
      .select('id, venue_id, email, name')
      .ilike('email', STAFF_EMAIL)
      .maybeSingle();

    if (!staffRow && !staffErr) {
      const at = STAFF_EMAIL.includes('@') ? STAFF_EMAIL.split('@')[1]! : '';
      if (at) {
        const r2 = await admin
          .from('staff')
          .select('id, venue_id, email, name')
          .ilike('email', `%@${at}`)
          .limit(5);
        const rows = r2.data ?? [];
        staffRow =
          rows.find((r) => (r.email as string).toLowerCase() === STAFF_EMAIL) ??
          rows[0] ??
          null;
        staffErr = r2.error;
      }
    }

    if (staffErr || !staffRow?.venue_id) {
      console.error(
        `No staff row for email (try exact account): "${STAFF_EMAIL}".`,
        staffErr?.message ?? '',
        '\nSet VENUE_ID=<uuid> to target the venue directly.',
      );
      process.exit(1);
    }
    staff = staffRow as typeof staff;
    venueId = staff.venue_id as string;
  }

  const { data: venue, error: venueErr } = await admin
    .from('venues')
    .select('id, name, table_management_enabled')
    .eq('id', venueId)
    .single();
  if (venueErr || !venue) {
    console.error('Venue not found', venueErr);
    process.exit(1);
  }

  console.log(`Venue: ${(venue as { name: string }).name} (${venueId})`);
  console.log(`Attributed staff: ${staff.email ?? staff.id} (${staff.id})`);

  const venueMode = await resolveVenueMode(admin, venueId);
  if (venueMode.bookingModel !== 'table_reservation') {
    console.error('This script only supports table_reservation venues; got:', venueMode.bookingModel);
    process.exit(1);
  }
  if (venueMode.availabilityEngine !== 'service') {
    console.error('Venue must use service availability engine.');
    process.exit(1);
  }

  const areaId = await getDefaultAreaIdForVenue(admin, venueId);
  if (!areaId) {
    console.error('No active dining area for venue (availability not set up).');
    process.exit(1);
  }

  const { data: serviceRows, error: vsErr } = await admin
    .from('venue_services')
    .select('id, name, sort_order')
    .eq('venue_id', venueId)
    .eq('is_active', true)
    .order('sort_order');

  if (vsErr || !serviceRows?.length) {
    console.error('venue_services:', vsErr);
    process.exit(1);
  }

  const { lunchId, dinnerId, lunchName, dinnerName } = resolveLunchDinnerServices(
    serviceRows as VenueServiceRow[],
  );
  console.log(`Lunch service: ${lunchName} (${lunchId})`);
  console.log(`Dinner service: ${dinnerName} (${dinnerId})`);

  type Created = { date: string; time: string; party_size: number; booking_id: string };

  const created: Created[] = [];
  const usedEmails = new Set<string>();

  async function createOne(
    bookingDate: string,
    allowedServiceIds: string[],
  ): Promise<void> {
    const partySize = randomPartySize();
    const engineInput = await fetchEngineInput({
      supabase: admin,
      venueId,
      date: bookingDate,
      partySize,
      areaId,
    });
    const slots = computeAvailability(engineInput).flatMap((r) => r.slots);
    const candidates = slots.filter(
      (s) =>
        allowedServiceIds.includes(s.service_id) &&
        s.available_covers >= partySize &&
        (!s.area_id || s.area_id === areaId),
    );
    if (candidates.length === 0) {
      throw new Error(
        `No slot for ${bookingDate} party ${partySize} (services ${allowedServiceIds.join(',')}). Check calendar / capacity.`,
      );
    }
    shuffleInPlace(candidates);
    const slot = candidates[0]!;
    const timeStr = slot.start_time;
    const timeForDb = timeStr.length === 5 ? `${timeStr}:00` : timeStr;

    const { durationMinutes, bufferMinutes } = await resolveDurationAndBufferForTableAssignment(
      admin,
      engineInput,
      bookingDate,
      partySize,
      slot.service_id,
    );
    const [y, mo, d] = bookingDate.split('-').map(Number);
    const [hh, mm] = timeStr.split(':').map(Number);
    const endDate = new Date(Date.UTC(y!, mo! - 1, d!, hh!, mm!, 0));
    endDate.setMinutes(endDate.getMinutes() + durationMinutes);
    const estimatedEndTime = endDate.toISOString();

    const refundHours = await resolveCancellationNoticeHoursForCreate({
      supabase: admin,
      venueId,
      effectiveModel: 'table_reservation',
      tableServiceId: slot.service_id,
    });
    const cancellationDeadline = cancellationDeadlineHoursBefore(bookingDate, timeForDb, refundHours);
    const cancellationPolicySnapshot = {
      refund_window_hours: refundHours,
      policy: `Full refund if cancelled ${refundHours}+ hours before reservation. No refund within ${refundHours} hours or for no-shows.`,
    };

    const email = uniqueTestEmail(usedEmails);
    const phone = randomUkE164();
    const lastSeed = email.replace('@resneo.com', '').slice(0, 80);

    const { guest } = await findOrCreateGuest(
      admin,
      venueId,
      { first_name: 'Test', last_name: lastSeed || 'Guest', email, phone },
      { silentAuthSignup: false },
    );

    const bookingInsert = {
      venue_id: venueId,
      guest_id: guest.id,
      booking_date: bookingDate,
      booking_time: timeForDb,
      party_size: partySize,
      status: 'Booked' as const,
      source: 'phone' as const,
      created_by_staff_id: staff.id,
      guest_email: email,
      guest_first_name: guest.first_name,
      guest_last_name: guest.last_name,
      guest_phone: phone,
      deposit_amount_pence: null as number | null,
      deposit_status: 'Not Required' as const,
      cancellation_deadline: cancellationDeadline,
      cancellation_policy_snapshot: cancellationPolicySnapshot,
      service_id: slot.service_id,
      estimated_end_time: estimatedEndTime,
      area_id: areaId,
      suppress_import_comms: true,
      dietary_notes: null,
      occasion: null,
      special_requests: null,
    };

    const { data: booking, error: bookErr } = await admin
      .from('bookings')
      .insert(bookingInsert)
      .select('id')
      .single();

    if (bookErr || !booking) {
      console.error('Insert failed', bookErr);
      throw bookErr ?? new Error('insert');
    }

    const bookingId = booking.id as string;

    if ((venue as { table_management_enabled?: boolean }).table_management_enabled) {
      const assigned = await autoAssignTable(
        admin,
        venueId,
        bookingId,
        bookingDate,
        timeStr,
        durationMinutes,
        bufferMinutes,
        partySize,
      );
      if (assigned) {
        await syncTableStatusesForBooking(admin, bookingId, assigned.table_ids, 'Booked', staff.id as string);
      } else {
        console.warn(`Table auto-assign skipped or none for booking ${bookingId}`);
      }
    }

    created.push({ date: bookingDate, time: timeStr, party_size: partySize, booking_id: bookingId });
    console.log(`+ ${bookingDate} ${timeStr} ×${partySize} → ${bookingId}`);
  }

  console.log('\n--- 10 lunch + 10 dinner on 2026-04-29 ---\n');
  for (let i = 0; i < 10; i++) {
    await createOne(DATES.lunchDinnerDay, [lunchId]);
  }
  for (let i = 0; i < 10; i++) {
    await createOne(DATES.lunchDinnerDay, [dinnerId]);
  }

  console.log('\n--- 10 bookings on 2026-05-01 (random lunch/dinner) ---\n');
  for (let i = 0; i < 10; i++) {
    const svc = Math.random() < 0.5 ? lunchId : dinnerId;
    await createOne(DATES.extraDay, [svc]);
  }

  console.log(`\nDone. ${created.length} bookings.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
