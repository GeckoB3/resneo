import { describe, it, expect, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { BookingEmailData } from '@/lib/emails/types';
import { enrichBookingEmailForComms } from '@/lib/emails/booking-email-enrichment';

/**
 * Regression: staff cancel/modify must use enrichBookingEmailForComms (not appointment-only)
 * so C/D/E bookings get event/class/resource titles in templates.
 */
describe('enrichBookingEmailForComms', () => {
  const bookingId = 'b-cde-1';
  const base: BookingEmailData = {
    id: bookingId,
    guest_name: 'Alex',
    guest_email: 'alex@example.com',
    booking_date: '2026-04-10',
    booking_time: '14:00',
    party_size: 2,
  };

  let callIndex: number;

  beforeEach(() => {
    callIndex = 0;
  });

  function makeMockClient(
    rows: Array<{ table: string; data: unknown }>,
    ticketLines: Array<{ label: string; quantity: number; unit_price_pence: number }> = [],
  ): SupabaseClient {
    return {
      from: (table: string) => ({
        select: () => ({
          eq: (_col: string, val: unknown) => {
            if (table === 'booking_ticket_lines') {
              if (val !== bookingId) {
                return Promise.resolve({ data: [], error: null });
              }
              return Promise.resolve({ data: ticketLines, error: null });
            }
            if (table === 'booking_addons') {
              // No add-ons in these fixtures; satisfy the chained `.order(...)` call.
              return {
                order: () => Promise.resolve({ data: [], error: null }),
              };
            }
            return {
              maybeSingle: async () => {
                const row = rows[callIndex];
                callIndex += 1;
                if (!row || row.table !== table) {
                  return { data: null, error: { message: 'unexpected query' } };
                }
                return { data: row.data, error: null };
              },
            };
          },
        }),
      }),
    } as unknown as SupabaseClient;
  }

  it('adds experience event name and booking_model for event_ticket rows', async () => {
    const out = await enrichBookingEmailForComms(
      makeMockClient(
        [
          {
            table: 'bookings',
            data: {
              practitioner_id: null,
              appointment_service_id: null,
              calendar_id: null,
              service_item_id: null,
              group_booking_id: null,
              guest_id: 'g1',
              person_label: null,
            },
          },
          {
            table: 'bookings',
            data: {
              experience_event_id: 'evt-uuid',
              class_instance_id: null,
              resource_id: null,
              booking_end_time: null,
              booking_time: '14:00:00',
              party_size: 2,
            },
          },
          {
            table: 'experience_events',
            data: { name: 'Spring Supper Club' },
          },
        ],
        [
          { label: 'Adult ticket', quantity: 2, unit_price_pence: 3000 },
        ],
      ),
      bookingId,
      base,
    );

    expect(out.booking_model).toBe('event_ticket');
    expect(out.email_variant).toBe('appointment');
    expect(out.appointment_service_name).toBe('Spring Supper Club');
    expect(out.booking_ticket_price_lines).toEqual([
      { label: 'Adult ticket', quantity: 2, unit_price_pence: 3000 },
    ]);
    expect(out.booking_total_price_pence).toBe(6000);
    expect(out.appointment_price_display).toBe('£60.00');
  });

  it('adds class type name for class_session rows', async () => {
    const client = makeMockClient([
      {
        table: 'bookings',
        data: {
          practitioner_id: null,
          appointment_service_id: null,
          calendar_id: null,
          service_item_id: null,
          group_booking_id: null,
          guest_id: 'g1',
          person_label: null,
        },
      },
      {
        table: 'bookings',
        data: {
          experience_event_id: null,
          class_instance_id: 'inst-uuid',
          resource_id: null,
          booking_end_time: null,
          booking_time: '14:00:00',
          party_size: 2,
        },
      },
      {
        table: 'class_instances',
        data: { class_type_id: 'ct-uuid' },
      },
      {
        table: 'class_types',
        data: { name: 'Vinyasa Flow', price_pence: 1200 },
      },
    ]);

    const out = await enrichBookingEmailForComms(client, bookingId, base);

    expect(out.booking_model).toBe('class_session');
    expect(out.appointment_service_name).toBe('Vinyasa Flow');
    expect(out.booking_total_price_pence).toBe(2400);
    expect(out.appointment_price_display).toBe('£24.00');
    expect(out.booking_unit_price_pence).toBe(1200);
    expect(out.booking_price_quantity).toBe(2);
  });

  it('adds resource name and host calendar name for resource_booking rows', async () => {
    const client = makeMockClient([
      {
        table: 'bookings',
        data: {
          practitioner_id: null,
          appointment_service_id: null,
          calendar_id: null,
          service_item_id: null,
          group_booking_id: null,
          guest_id: 'g1',
          person_label: null,
        },
      },
      {
        table: 'bookings',
        data: {
          experience_event_id: null,
          class_instance_id: null,
          resource_id: 'res-uuid',
          booking_end_time: '16:30:00',
          booking_time: '14:00:00',
          party_size: 1,
        },
      },
      {
        table: 'venue_resources',
        data: {
          name: 'Court 2',
          display_on_calendar_id: 'host-cal-uuid',
          price_per_slot_pence: 500,
          slot_interval_minutes: 30,
        },
      },
      {
        table: 'unified_calendars',
        data: { name: 'Reception' },
      },
      {
        table: 'venue_resources',
        data: {
          name: 'Court 2',
          display_on_calendar_id: 'host-cal-uuid',
          price_per_slot_pence: 500,
          slot_interval_minutes: 30,
        },
      },
    ]);

    const out = await enrichBookingEmailForComms(client, bookingId, base);

    expect(out.booking_model).toBe('resource_booking');
    expect(out.appointment_service_name).toBe('Court 2');
    expect(out.practitioner_name).toBe('Reception');
    expect(out.booking_total_price_pence).toBe(2500);
    expect(out.appointment_price_display).toBe('£25.00');
  });
});

// ── Per-practitioner price override (regression) ──────────────────────────────
describe('enrichBookingEmailForComms appointment pricing', () => {
  const bookingId = 'b-appt-1';
  const base: BookingEmailData = {
    id: bookingId,
    guest_name: 'Norah',
    guest_email: 'norah@example.com',
    booking_date: '2026-04-10',
    booking_time: '10:00',
    party_size: 1,
  };

  /** Chainable mock that answers by table (bookings differs anchor vs secondary). */
  function makeApptClient(data: {
    anchor: Record<string, unknown>;
    practitioner: { name: string } | null;
    service: { name: string; price_pence: number | null } | null;
    link: { custom_price_pence: number | null } | null;
    variant?: { name: string; price_pence: number | null } | null;
  }): SupabaseClient {
    let bookingsCalls = 0;
    const rowFor = (table: string): unknown => {
      switch (table) {
        case 'bookings':
          bookingsCalls += 1;
          return bookingsCalls === 1
            ? data.anchor
            : {
                experience_event_id: null,
                class_instance_id: null,
                resource_id: null,
                booking_end_time: null,
                booking_time: '10:00:00',
                party_size: 1,
              };
        case 'practitioners':
          return data.practitioner;
        case 'appointment_services':
          return data.service;
        case 'practitioner_services':
          return data.link;
        case 'service_variants':
          return data.variant ?? null;
        default:
          return null;
      }
    };
    const builder = (table: string): Record<string, unknown> => {
      const b: Record<string, unknown> = {};
      b.eq = () => b;
      b.order = () => Promise.resolve({ data: [], error: null });
      b.maybeSingle = async () => ({ data: rowFor(table), error: null });
      return b;
    };
    return {
      from: (table: string) => ({ select: () => builder(table) }),
    } as unknown as SupabaseClient;
  }

  const legacyAnchor = {
    booking_model: 'appointment',
    practitioner_id: 'pr-1',
    appointment_service_id: 'svc-1',
    calendar_id: null,
    service_item_id: null,
    service_variant_id: null,
    group_booking_id: null,
    guest_id: 'g-1',
    person_label: null,
    location_type: null,
  };

  it('uses the per-practitioner custom price over the base service price', async () => {
    const out = await enrichBookingEmailForComms(
      makeApptClient({
        anchor: legacyAnchor,
        practitioner: { name: 'Norah' },
        service: { name: 'Haircut', price_pence: 2800 },
        link: { custom_price_pence: 2600 },
      }),
      bookingId,
      base,
    );
    expect(out.appointment_service_name).toBe('Haircut');
    expect(out.appointment_price_display).toBe('£26.00');
    expect(out.booking_total_price_pence).toBe(2600);
  });

  it('falls back to the base service price when there is no override', async () => {
    const out = await enrichBookingEmailForComms(
      makeApptClient({
        anchor: legacyAnchor,
        practitioner: { name: 'Norah' },
        service: { name: 'Haircut', price_pence: 2800 },
        link: null,
      }),
      bookingId,
      base,
    );
    expect(out.appointment_price_display).toBe('£28.00');
    expect(out.booking_total_price_pence).toBe(2800);
  });

  it('lets a chosen variant price win over the practitioner override', async () => {
    const out = await enrichBookingEmailForComms(
      makeApptClient({
        anchor: { ...legacyAnchor, service_variant_id: 'var-1' },
        practitioner: { name: 'Norah' },
        service: { name: 'Haircut', price_pence: 2800 },
        link: { custom_price_pence: 2600 },
        variant: { name: 'Long hair', price_pence: 3200 },
      }),
      bookingId,
      base,
    );
    expect(out.appointment_service_name).toBe('Haircut - Long hair');
    expect(out.appointment_price_display).toBe('£32.00');
    expect(out.booking_total_price_pence).toBe(3200);
  });
});

// ── Add-ons enrichment ────────────────────────────────────────────────────────
describe('enrichBookingEmailForComms with add-ons', () => {
  const bookingId = 'b-addons-1';
  const base: BookingEmailData = {
    id: bookingId,
    guest_name: 'Alex',
    guest_email: 'alex@example.com',
    booking_date: '2026-04-10',
    booking_time: '14:00',
    party_size: 1,
  };

  /**
   * Mock that returns the appointment anchor row (no add-on labels needed because
   * the appointment lookup fails over to a quiet return), then returns the supplied
   * add-on rows when the `booking_addons` table is queried.
   */
  function makeAddonClient(addonRows: Array<{
    addon_name_snapshot: string;
    addon_group_name_snapshot: string | null;
    price_pence_at_booking: number;
    duration_minutes_at_booking: number;
  }>): SupabaseClient {
    let appointmentAnchorReturned = false;
    return {
      from: (table: string) => ({
        select: () => ({
          eq: (_col: string, _val: unknown) => {
            if (table === 'booking_ticket_lines') {
              return Promise.resolve({ data: [], error: null });
            }
            if (table === 'booking_addons') {
              return { order: () => Promise.resolve({ data: addonRows, error: null }) };
            }
            return {
              maybeSingle: async () => {
                if (table === 'bookings' && !appointmentAnchorReturned) {
                  // First call: appointment anchor lookup.
                  appointmentAnchorReturned = true;
                  return {
                    data: {
                      practitioner_id: null,
                      appointment_service_id: null,
                      calendar_id: null,
                      service_item_id: null,
                      group_booking_id: null,
                      guest_id: 'g1',
                      person_label: null,
                    },
                    error: null,
                  };
                }
                if (table === 'bookings') {
                  // Second call: C/D/E secondary models lookup; return empty so nothing matches.
                  return {
                    data: {
                      experience_event_id: null,
                      class_instance_id: null,
                      resource_id: null,
                      booking_end_time: null,
                      booking_time: '14:00:00',
                      party_size: 1,
                    },
                    error: null,
                  };
                }
                return { data: null, error: null };
              },
            };
          },
        }),
      }),
    } as unknown as SupabaseClient;
  }

  it('adds addon_lines + totals when booking has add-ons', async () => {
    const out = await enrichBookingEmailForComms(
      makeAddonClient([
        {
          addon_name_snapshot: 'Argan oil conditioner',
          addon_group_name_snapshot: 'Conditioner choice',
          price_pence_at_booking: 500,
          duration_minutes_at_booking: 0,
        },
        {
          addon_name_snapshot: 'Olaplex treatment',
          addon_group_name_snapshot: 'Finishing touches',
          price_pence_at_booking: 1000,
          duration_minutes_at_booking: 15,
        },
      ]),
      bookingId,
      base,
    );

    expect(out.addon_lines).toEqual([
      'Conditioner choice: Argan oil conditioner (+£5.00)',
      'Finishing touches: Olaplex treatment (+£10.00, +15 min)',
    ]);
    expect(out.addons_total_price_pence).toBe(1500);
    expect(out.addons_total_duration_minutes).toBe(15);
    // No prior total: rolls add-on price into headline total.
    expect(out.booking_total_price_pence).toBe(1500);
  });

  it('rolls add-on price into existing booking_total_price_pence', async () => {
    const out = await enrichBookingEmailForComms(
      makeAddonClient([
        {
          addon_name_snapshot: 'Toner',
          addon_group_name_snapshot: null,
          price_pence_at_booking: 800,
          duration_minutes_at_booking: 0,
        },
      ]),
      bookingId,
      { ...base, booking_total_price_pence: 4000 },
    );
    expect(out.addon_lines).toEqual(['Toner (+£8.00)']);
    expect(out.addons_total_price_pence).toBe(800);
    expect(out.booking_total_price_pence).toBe(4800);
  });

  it('omits price segment for free add-ons but keeps duration', async () => {
    const out = await enrichBookingEmailForComms(
      makeAddonClient([
        {
          addon_name_snapshot: 'Patch test',
          addon_group_name_snapshot: 'Staff add-ons',
          price_pence_at_booking: 0,
          duration_minutes_at_booking: 10,
        },
      ]),
      bookingId,
      base,
    );
    expect(out.addon_lines).toEqual(['Staff add-ons: Patch test (+10 min)']);
    expect(out.addons_total_price_pence).toBe(0);
    expect(out.addons_total_duration_minutes).toBe(10);
  });

  it('renders bare option name when no group, no price, no duration', async () => {
    const out = await enrichBookingEmailForComms(
      makeAddonClient([
        {
          addon_name_snapshot: 'Note for stylist',
          addon_group_name_snapshot: null,
          price_pence_at_booking: 0,
          duration_minutes_at_booking: 0,
        },
      ]),
      bookingId,
      base,
    );
    expect(out.addon_lines).toEqual(['Note for stylist']);
  });

  it('returns unchanged email data when there are no add-ons', async () => {
    const out = await enrichBookingEmailForComms(makeAddonClient([]), bookingId, base);
    expect(out.addon_lines).toBeUndefined();
    expect(out.addons_total_price_pence).toBeUndefined();
  });
});
