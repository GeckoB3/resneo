import { describe, expect, it, vi } from 'vitest';
import { FakeSupabase } from '@/lib/compliance/test-utils/fake-supabase';
import {
  ensureComplianceFormLinksForBooking,
  runComplianceFormReminders,
  type FormReminderTarget,
} from '@/lib/compliance/auto-send';

const VENUE = 'venue-1';
const GUEST = 'guest-1';
const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
const futureDate = (days: number) => future(days).slice(0, 10);

function venueRow(autoSend: boolean, enabled = true) {
  return {
    id: VENUE,
    pricing_tier: enabled ? 'appointments' : 'restaurant',
    feature_flags: enabled
      ? { compliance_records_enabled: true, compliance: { auto_send_on_booking: autoSend } }
      : {},
    booking_model: 'unified_scheduling',
    enabled_models: null,
  };
}

function reqRow(typeId: string, enforcement = 'warn_client', lock: number | null = null) {
  return {
    id: `req-${typeId}`,
    venue_id: VENUE,
    service_item_id: 'svc-1',
    compliance_type_id: typeId,
    enforcement,
    lock_period_hours: lock,
  };
}

function typeRow(id: string, captureMethods: string[]) {
  return {
    id,
    venue_id: VENUE,
    name: `Type ${id}`,
    capture_methods: captureMethods,
    current_version_id: `ver-${id}`,
    form_link_expiry_days: null,
    is_active: true,
  };
}

const baseParams = {
  venueId: VENUE,
  guestId: GUEST,
  bookingId: 'booking-1',
  appointmentServiceId: null,
  serviceItemId: 'svc-1' as string | null,
  bookingDate: futureDate(7),
  bookingTime: '10:00',
};

describe('ensureComplianceFormLinksForBooking', () => {
  it('returns [] when auto-send is off', async () => {
    const fake = new FakeSupabase({
      venues: [venueRow(false)],
      service_compliance_requirements: [reqRow('t1')],
      compliance_types: [typeRow('t1', ['client_online'])],
      compliance_type_versions: [{ id: 'ver-t1' }],
      guests: [{ id: GUEST, venue_id: VENUE, email: 'g@x.com' }],
    });
    expect(await ensureComplianceFormLinksForBooking(fake.asClient(), baseParams)).toEqual([]);
  });

  it('issues a link for an unmet client-online requirement and returns it', async () => {
    const fake = new FakeSupabase({
      venues: [venueRow(true)],
      service_compliance_requirements: [reqRow('t1')],
      compliance_types: [typeRow('t1', ['client_online', 'staff_in_venue'])],
      compliance_type_versions: [{ id: 'ver-t1' }],
      compliance_records: [],
      guests: [{ id: GUEST, venue_id: VENUE, email: 'g@x.com' }],
    });
    const links = await ensureComplianceFormLinksForBooking(fake.asClient(), baseParams);
    expect(links).toHaveLength(1);
    // (name comes from a Supabase !inner join the fake doesn't resolve; assert it's present)
    expect(typeof links[0]!.name).toBe('string');
    expect(links[0]!.url).toContain('/p/forms/');
    // A pending link row was created.
    expect((fake.tables.compliance_form_links ?? []).length).toBe(1);
  });

  it('skips a staff-only (non client-online) type', async () => {
    const fake = new FakeSupabase({
      venues: [venueRow(true)],
      service_compliance_requirements: [reqRow('t1')],
      compliance_types: [typeRow('t1', ['staff_in_venue'])],
      compliance_type_versions: [{ id: 'ver-t1' }],
      compliance_records: [],
      guests: [{ id: GUEST, venue_id: VENUE, email: 'g@x.com' }],
    });
    expect(await ensureComplianceFormLinksForBooking(fake.asClient(), baseParams)).toEqual([]);
    expect(fake.tables.compliance_form_links ?? []).toHaveLength(0);
  });

  it('skips when the online submission window has passed (lock_period_hours)', async () => {
    const fake = new FakeSupabase({
      venues: [venueRow(true)],
      service_compliance_requirements: [reqRow('t1', 'block_online', 48)],
      compliance_types: [typeRow('t1', ['client_online'])],
      compliance_type_versions: [{ id: 'ver-t1' }],
      compliance_records: [],
      guests: [{ id: GUEST, venue_id: VENUE, email: 'g@x.com' }],
    });
    // Booking ~1h away but the form needs 48h lead time → online window closed.
    const soon = new Date(Date.now() + 60 * 60 * 1000);
    const params = {
      ...baseParams,
      bookingDate: soon.toISOString().slice(0, 10),
      bookingTime: `${String(soon.getHours()).padStart(2, '0')}:00`,
    };
    expect(await ensureComplianceFormLinksForBooking(fake.asClient(), params)).toEqual([]);
  });

  it('returns [] when the guest already has a valid record (satisfied)', async () => {
    const fake = new FakeSupabase({
      venues: [venueRow(true)],
      service_compliance_requirements: [reqRow('t1')],
      compliance_types: [typeRow('t1', ['client_online'])],
      compliance_type_versions: [{ id: 'ver-t1' }],
      compliance_records: [
        {
          id: 'rec1',
          venue_id: VENUE,
          guest_id: GUEST,
          compliance_type_id: 't1',
          status: 'completed',
          expires_at: null,
          voided_at: null,
          captured_at: future(-1),
        },
      ],
      guests: [{ id: GUEST, venue_id: VENUE, email: 'g@x.com' }],
    });
    expect(await ensureComplianceFormLinksForBooking(fake.asClient(), baseParams)).toEqual([]);
  });
});

describe('runComplianceFormReminders', () => {
  function setup(linkOverrides: Record<string, unknown> = {}, bookingOverrides: Record<string, unknown> = {}) {
    return new FakeSupabase({
      venues: [venueRow(true)],
      compliance_form_links: [
        {
          id: 'l1',
          code: 'abcdefghij',
          venue_id: VENUE,
          guest_id: GUEST,
          compliance_type_id: 't1',
          booking_id: 'b1',
          status: 'pending',
          reminder_count: 0,
          last_reminded_at: null,
          expires_at: future(10),
          ...linkOverrides,
        },
      ],
      bookings: [
        {
          id: 'b1',
          venue_id: VENUE,
          booking_date: futureDate(2),
          booking_time: '10:00',
          status: 'Confirmed',
          ...bookingOverrides,
        },
      ],
    });
  }

  it('reminds a pending link for an upcoming booking and bumps the count', async () => {
    const fake = setup();
    const send = vi.fn(async (_t: FormReminderTarget) => true);
    const res = await runComplianceFormReminders(fake.asClient(), { sendReminder: send });
    expect(send).toHaveBeenCalledTimes(1);
    expect(res.sent).toBe(1);
    const link = (fake.tables.compliance_form_links ?? [])[0]!;
    expect(link.reminder_count).toBe(1);
    expect(link.last_reminded_at).toBeTruthy();
  });

  it('does not select links that already hit the cap', async () => {
    const fake = setup({ reminder_count: 2 });
    const send = vi.fn(async () => true);
    await runComplianceFormReminders(fake.asClient(), { sendReminder: send, maxReminders: 2 });
    expect(send).not.toHaveBeenCalled();
  });

  it('skips bookings outside the upcoming window', async () => {
    const fake = setup({}, { booking_date: futureDate(10) }); // >72h away
    const send = vi.fn(async () => true);
    await runComplianceFormReminders(fake.asClient(), { sendReminder: send });
    expect(send).not.toHaveBeenCalled();
  });

  it('skips past / inactive bookings', async () => {
    const fake = setup({}, { status: 'Cancelled' });
    const send = vi.fn(async () => true);
    await runComplianceFormReminders(fake.asClient(), { sendReminder: send });
    expect(send).not.toHaveBeenCalled();
  });

  it('throttles when reminded recently', async () => {
    const fake = setup({ last_reminded_at: new Date(Date.now() - 60 * 60 * 1000).toISOString() }); // 1h ago
    const send = vi.fn(async () => true);
    await runComplianceFormReminders(fake.asClient(), { sendReminder: send });
    expect(send).not.toHaveBeenCalled();
  });

  it('still bumps the count when the send fails (avoids hammering)', async () => {
    const fake = setup();
    const send = vi.fn(async () => false);
    const res = await runComplianceFormReminders(fake.asClient(), { sendReminder: send });
    expect(res.sent).toBe(0);
    expect((fake.tables.compliance_form_links ?? [])[0]!.reminder_count).toBe(1);
  });
});
