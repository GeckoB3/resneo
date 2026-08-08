import { describe, expect, it } from 'vitest';
import { resolveEmailLocation } from '@/lib/emails/booking-location';
import type { BookingEmailData, VenueEmailData } from '@/lib/emails/types';

const venue: VenueEmailData = {
  name: 'Test Venue',
  address: '1 Main Street, Belfast, BT1 1AA',
};

function baseBooking(overrides: Partial<BookingEmailData> = {}): BookingEmailData {
  return {
    id: 'b1',
    guest_name: 'Alex Guest',
    booking_date: '2026-06-20',
    booking_time: '10:00',
    party_size: 1,
    ...overrides,
  };
}

describe('resolveEmailLocation', () => {
  it('defaults to the venue address with a maps link (no booking_location)', () => {
    const r = resolveEmailLocation(baseBooking(), venue);
    expect(r.kind).toBe('business_venue');
    expect(r.rowValue).toBe('1 Main Street, Belfast, BT1 1AA');
    expect(r.mapsUrl).toContain('google.com/maps');
    expect(r.joinUrl).toBeNull();
    expect(r.calendarLocation).toBe('1 Main Street, Belfast, BT1 1AA');
  });

  it('business_venue kind behaves like the default', () => {
    const r = resolveEmailLocation(
      baseBooking({ booking_location: { kind: 'business_venue' } }),
      venue,
    );
    expect(r.kind).toBe('business_venue');
    expect(r.rowValue).toBe(venue.address);
  });

  it('omits the location row when the venue has no address', () => {
    const r = resolveEmailLocation(baseBooking(), { name: 'No Address Venue' });
    expect(r.rowValue).toBeNull();
    expect(r.mapsUrl).toBeNull();
    expect(r.textLines).toEqual([]);
  });

  it("client_address shows the client's address and suppresses maps", () => {
    const r = resolveEmailLocation(
      baseBooking({
        booking_location: { kind: 'client_address', client_address: '5 Oak Road, Lisburn, BT28 9XY' },
      }),
      venue,
    );
    expect(r.kind).toBe('client_address');
    expect(r.rowValue).toBe('Your address (5 Oak Road, Lisburn, BT28 9XY)');
    expect(r.mapsUrl).toBeNull();
    expect(r.joinUrl).toBeNull();
    expect(r.calendarLocation).toBe('5 Oak Road, Lisburn, BT28 9XY');
    expect(r.textLines).toEqual(['Location: Your address (5 Oak Road, Lisburn, BT28 9XY)']);
  });

  it('client_address without a captured address still labels the location', () => {
    const r = resolveEmailLocation(
      baseBooking({ booking_location: { kind: 'client_address', client_address: null } }),
      venue,
    );
    expect(r.rowValue).toBe('Your address');
    expect(r.calendarLocation).toBeNull();
  });

  it('online shows the join link and info instead of the venue address', () => {
    const r = resolveEmailLocation(
      baseBooking({
        booking_location: {
          kind: 'online',
          online_url: 'https://zoom.us/j/123',
          online_info: 'Passcode 9876. Join 5 minutes early.',
        },
      }),
      venue,
    );
    expect(r.kind).toBe('online');
    expect(r.rowValue).toBe('Online');
    expect(r.rowExtra).toBe('Passcode 9876. Join 5 minutes early.');
    expect(r.joinUrl).toBe('https://zoom.us/j/123');
    expect(r.mapsUrl).toBeNull();
    expect(r.calendarLocation).toBe('https://zoom.us/j/123');
    expect(r.textLines).toEqual([
      'Location: Online',
      'Join online: https://zoom.us/j/123',
      'Passcode 9876. Join 5 minutes early.',
    ]);
  });

  it('online without a link still marks the booking as online', () => {
    const r = resolveEmailLocation(
      baseBooking({ booking_location: { kind: 'online', online_url: null, online_info: null } }),
      venue,
    );
    expect(r.rowValue).toBe('Online');
    expect(r.joinUrl).toBeNull();
    expect(r.calendarLocation).toBe('Online');
    expect(r.textLines).toEqual(['Location: Online']);
  });
});
