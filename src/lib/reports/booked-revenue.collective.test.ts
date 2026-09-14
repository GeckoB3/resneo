import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/linked-accounts/queries', () => ({ loadAccessibleLinkedVenueIds: vi.fn() }));
vi.mock('@/lib/linked-accounts/collective-staff-scope', () => ({ findStaffCollectiveForVenue: vi.fn() }));
vi.mock('@/lib/booking/payment-summary', () => ({
  loadRowTotalResolver: vi.fn(async () => ({
    rowTotal: (r: { booking_total_price_pence?: number | null }) => r.booking_total_price_pence ?? null,
  })),
}));

import { loadAccessibleLinkedVenueIds } from '@/lib/linked-accounts/queries';
import { findStaffCollectiveForVenue } from '@/lib/linked-accounts/collective-staff-scope';
import { aggregateBookedRevenue, buildBookedRevenueReport, type BookedRevenueColumn } from './booked-revenue';

/**
 * REP-01 to REP-03 and REP-05 (W17, D49): every venue named and subtotalled, collective-page
 * bookings picked out, and a collective member visible through the membership whatever its link says.
 */

type Tables = {
  venues: Array<Record<string, unknown>>;
  unified_calendars: Array<Record<string, unknown>>;
  bookings: Array<Record<string, unknown>>;
};

/** A tiny client: filters rows by eq/in on the queried table, and remembers which venues it read. */
function client(tables: Tables, label: string, reads: string[]) {
  return {
    from(table: keyof Tables) {
      let rows = [...tables[table]];
      const builder: Record<string, unknown> = {};
      const self = () => builder;
      builder.select = self;
      builder.order = self;
      builder.neq = (col: string, v: unknown) => ((rows = rows.filter((r) => r[col] !== v)), builder);
      builder.gte = (col: string, v: string) => ((rows = rows.filter((r) => String(r[col]) >= v)), builder);
      builder.lte = (col: string, v: string) => ((rows = rows.filter((r) => String(r[col]) <= v)), builder);
      builder.eq = (col: string, v: unknown) => {
        if (col === 'venue_id') reads.push(`${label}:${table}:${String(v)}`);
        rows = rows.filter((r) => r[col] === v);
        return builder;
      };
      builder.in = (col: string, vs: unknown[]) => ((rows = rows.filter((r) => vs.includes(r[col]))), builder);
      builder.then = (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null });
      return builder;
    },
  } as never;
}

const world: Tables = {
  venues: [
    { id: 'host', name: 'Host Studio' },
    { id: 'member', name: 'Member Salon' },
    { id: 'partner', name: 'Linked Barber' },
  ],
  unified_calendars: [
    { id: 'cal-h', venue_id: 'host', name: 'Hana', sort_order: 0 },
    { id: 'cal-m', venue_id: 'member', name: 'Mo', sort_order: 0 },
    { id: 'cal-p', venue_id: 'partner', name: 'Pip', sort_order: 0 },
  ],
  bookings: [
    { id: 'b1', venue_id: 'host', calendar_id: 'cal-h', booking_date: '2026-09-10', status: 'Booked', booking_total_price_pence: 3000, collective_id: null },
    { id: 'b2', venue_id: 'host', calendar_id: 'cal-h', booking_date: '2026-09-10', status: 'Booked', booking_total_price_pence: 2000, collective_id: 'col-1' },
    { id: 'b3', venue_id: 'member', calendar_id: 'cal-m', booking_date: '2026-09-10', status: 'Booked', booking_total_price_pence: 5000, collective_id: 'col-1' },
    { id: 'b4', venue_id: 'member', calendar_id: 'cal-m', booking_date: '2026-09-10', status: 'No-Show', booking_total_price_pence: 1000, collective_id: 'col-1' },
    { id: 'b5', venue_id: 'partner', calendar_id: 'cal-p', booking_date: '2026-09-10', status: 'Booked', booking_total_price_pence: 700, collective_id: null },
  ],
};

const input = { venueId: 'host', venueName: 'Host Studio', from: '2026-09-10', to: '2026-09-10', grain: 'day' as const, today: '2026-09-10' };

describe('buildBookedRevenueReport across a collective', () => {
  beforeEach(() => {
    vi.mocked(findStaffCollectiveForVenue).mockResolvedValue({
      collectiveId: 'col-1',
      name: 'High Street Collective',
      hostVenueId: 'host',
      memberVenueIds: ['host', 'member'],
    });
  });

  it('names and subtotals every venue, and picks out bookings made through the collective page (REP-02, REP-03)', async () => {
    vi.mocked(loadAccessibleLinkedVenueIds).mockResolvedValue([
      { venueId: 'member', grant: { calendar: 'full_details', pii: true, act: 'create_edit_cancel' } },
      { venueId: 'partner', grant: { calendar: 'full_details', pii: true, act: 'create_edit_cancel' } },
    ] as never);
    const reads: string[] = [];
    const report = await buildBookedRevenueReport(client(world, 'caller', reads), input, {
      serviceClient: client(world, 'service', reads),
    });

    expect(report.collective).toEqual({ id: 'col-1', name: 'High Street Collective' });
    expect(report.venues).toEqual([
      { venue_id: 'host', venue_name: 'Host Studio', access: 'own' },
      { venue_id: 'member', venue_name: 'Member Salon', access: 'collective' },
      { venue_id: 'partner', venue_name: 'Linked Barber', access: 'link' },
    ]);
    expect(report.totals.by_venue.host).toMatchObject({ booked_pence: 5000, collective_booked_pence: 2000 });
    expect(report.totals.by_venue.member).toMatchObject({
      booked_pence: 5000,
      no_show_pence: 1000,
      collective_booked_pence: 5000,
      collective_no_show_pence: 1000,
      collective_count: 2,
    });
    expect(report.totals.by_venue.partner).toMatchObject({ booked_pence: 700, collective_booked_pence: 0 });
    expect(report.totals.booked_pence).toBe(10700);
  });

  it('keeps a collective member when its link no longer grants revenue, reading it with the service client (REP-05)', async () => {
    vi.mocked(loadAccessibleLinkedVenueIds).mockResolvedValue([
      { venueId: 'member', grant: { calendar: 'time_only', pii: false, act: 'none' } },
    ] as never);
    const reads: string[] = [];
    const report = await buildBookedRevenueReport(client(world, 'caller', reads), input, {
      serviceClient: client(world, 'service', reads),
    });
    expect(report.venues.map((v) => v.venue_id)).toEqual(['host', 'member']);
    expect(report.totals.by_venue.member?.booked_pence).toBe(5000);
    expect(reads).toContain('service:bookings:member');
    expect(reads).not.toContain('caller:bookings:member');
  });

  it('after the membership ends, a venue shows only through its link grant (REP-06)', async () => {
    vi.mocked(findStaffCollectiveForVenue).mockResolvedValue(null);
    vi.mocked(loadAccessibleLinkedVenueIds).mockResolvedValue([
      { venueId: 'member', grant: { calendar: 'time_only', pii: false, act: 'none' } },
    ] as never);
    const reads: string[] = [];
    const report = await buildBookedRevenueReport(client(world, 'caller', reads), input, {
      serviceClient: client(world, 'service', reads),
    });
    expect(report.collective).toBeNull();
    expect(report.venues.map((v) => v.venue_id)).toEqual(['host']);
    // Its own collective-page bookings are still identified.
    expect(report.totals.by_venue.host?.collective_booked_pence).toBe(2000);
  });
});

describe('aggregateBookedRevenue venue subtotals', () => {
  const col = (key: string, venue: string, linked: boolean): BookedRevenueColumn => ({
    key,
    calendar_id: key,
    name: key,
    venue_id: venue,
    venue_name: venue.toUpperCase(),
    linked,
    colour: null,
  });

  it('derives the venue list from the columns when none is given', () => {
    const report = aggregateBookedRevenue({
      from: '2026-09-10',
      to: '2026-09-10',
      grain: 'day',
      today: '2026-09-10',
      columns: [col('a', 'v1', false), col('b', 'v2', true)],
      rows: [
        { booking_date: '2026-09-10', status: 'Booked', calendar_id: 'a', venue_id: 'v1', pence: 100 },
        { booking_date: '2026-09-10', status: 'Booked', calendar_id: 'b', venue_id: 'v2', pence: 250 },
      ],
    });
    expect(report.venues).toEqual([
      { venue_id: 'v1', venue_name: 'V1', access: 'own' },
      { venue_id: 'v2', venue_name: 'V2', access: 'link' },
    ]);
    expect(report.totals.by_venue.v1?.booked_pence).toBe(100);
    expect(report.totals.by_venue.v2?.booked_pence).toBe(250);
    expect(report.collective).toBeNull();
  });
});
