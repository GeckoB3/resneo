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
