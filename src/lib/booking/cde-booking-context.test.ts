import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveCdeBookingContext } from '@/lib/booking/cde-booking-context';

/**
 * resolveCdeBookingContext: backward-compatible {title, subtitle} plus optional
 * enrichment (event ticket lines, class roster, resource duration). The account
 * portal consumes the enriched fields, so this locks their shape.
 *
 * Mock shape: `.from(table).select(cols)` then either
 *  - `.eq(col,val).maybeSingle()`  (single-row lookups), or
 *  - `.eq(col,val)` awaited        (list lookups: booking_ticket_lines, bookings).
 */
type TableRows = Record<string, unknown>;

function makeClient(opts: {
  single?: Record<string, TableRows | null>;
  list?: Record<string, TableRows[]>;
}): Pick<SupabaseClient, 'from'> {
  const single = opts.single ?? {};
  const list = opts.list ?? {};
  return {
    from: (table: string) => ({
      select: () => ({
        eq: (_col: string, _val: unknown) => {
          const listResult = { data: list[table] ?? [], error: null };
          const p = Promise.resolve(listResult) as Promise<typeof listResult> & {
            maybeSingle: () => Promise<{ data: TableRows | null; error: null }>;
          };
          p.maybeSingle = async () => ({ data: single[table] ?? null, error: null });
          return p;
        },
      }),
    }),
  } as unknown as Pick<SupabaseClient, 'from'>;
}

describe('resolveCdeBookingContext', () => {
  it('returns null for a row with no C/D/E foreign keys', async () => {
    const ctx = await resolveCdeBookingContext(makeClient({}), {});
    expect(ctx).toBeNull();
  });

  it('keeps the original {title, subtitle} for an event and adds ticket lines', async () => {
    const ctx = await resolveCdeBookingContext(
      makeClient({
        single: { experience_events: { name: 'Wine Tasting', end_time: '21:30:00' } },
        list: {
          booking_ticket_lines: [
            { label: 'Adult', quantity: 2 },
            { label: 'Child', quantity: 1 },
          ],
        },
      }),
      { id: 'bk-1', experience_event_id: 'ev-1' },
    );
    expect(ctx?.inferred_model).toBe('event_ticket');
    expect(ctx?.title).toBe('Wine Tasting');
    expect(ctx?.subtitle).toBe('Ends 21:30');
    expect(ctx?.ticket_lines).toEqual([
      { label: 'Adult', quantity: 2 },
      { label: 'Child', quantity: 1 },
    ]);
    expect(ctx?.ticket_summary).toBe('2× Adult, 1× Child');
    expect(ctx?.ticket_total_quantity).toBe(3);
  });

  it('omits ticket enrichment when there are no ticket lines (backward-compatible)', async () => {
    const ctx = await resolveCdeBookingContext(
      makeClient({ single: { experience_events: { name: 'Gig', end_time: null } } }),
      { id: 'bk-2', experience_event_id: 'ev-2' },
    );
    expect(ctx?.title).toBe('Gig');
    expect(ctx?.subtitle).toBeNull();
    expect(ctx?.ticket_lines).toBeUndefined();
    expect(ctx?.ticket_summary).toBeUndefined();
    expect(ctx?.ticket_total_quantity).toBeUndefined();
  });

  it('adds class roster (booked / capacity) counting only capacity-consuming statuses', async () => {
    const ctx = await resolveCdeBookingContext(
      makeClient({
        single: {
          class_instances: { start_time: '09:00:00', class_type_id: 'ct-1', capacity_override: null },
          class_types: { name: 'Vinyasa Flow', capacity: 12 },
        },
        list: {
          bookings: [
            { party_size: 2, status: 'Booked' },
            { party_size: 1, status: 'Confirmed' },
            { party_size: 3, status: 'Cancelled' }, // excluded
            { party_size: 1, status: 'No-Show' }, // excluded
          ],
        },
      }),
      { class_instance_id: 'ci-1' },
    );
    expect(ctx?.inferred_model).toBe('class_session');
    expect(ctx?.title).toBe('Vinyasa Flow');
    expect(ctx?.subtitle).toBe('Starts 09:00');
    expect(ctx?.roster).toEqual({ booked: 3, capacity: 12 });
    expect(ctx?.roster_summary).toBe('3 / 12 booked');
  });

  it('prefers capacity_override over the class type capacity for the roster', async () => {
    const ctx = await resolveCdeBookingContext(
      makeClient({
        single: {
          class_instances: { start_time: '18:00:00', class_type_id: 'ct-2', capacity_override: 6 },
          class_types: { name: 'Spin', capacity: 20 },
        },
        list: { bookings: [{ party_size: 1, status: 'Booked' }] },
      }),
      { class_instance_id: 'ci-2' },
    );
    expect(ctx?.roster).toEqual({ booked: 1, capacity: 6 });
    expect(ctx?.roster_summary).toBe('1 / 6 booked');
  });

  it('adds resource duration derived from start/end wall-clock', async () => {
    const ctx = await resolveCdeBookingContext(
      makeClient({
        single: { unified_calendars: { name: 'Court 1', display_on_calendar_id: null } },
      }),
      { resource_id: 'r-1', booking_time: '10:00', booking_end_time: '11:30' },
    );
    expect(ctx?.inferred_model).toBe('resource_booking');
    expect(ctx?.title).toBe('Court 1');
    expect(ctx?.duration_minutes).toBe(90);
  });

  it('omits resource duration when the end time is missing', async () => {
    const ctx = await resolveCdeBookingContext(
      makeClient({
        single: { unified_calendars: { name: 'Studio', display_on_calendar_id: null } },
      }),
      { resource_id: 'r-2', booking_time: '10:00' },
    );
    expect(ctx?.title).toBe('Studio');
    expect(ctx?.duration_minutes).toBeUndefined();
  });
});
