import { describe, expect, it } from 'vitest';
import {
  resolveStaffBookingLocation,
  staffBookingLocationPillLabel,
} from './staff-booking-location';

describe('resolveStaffBookingLocation', () => {
  it('returns null for business-venue bookings, so the team is not told where their own venue is', () => {
    expect(resolveStaffBookingLocation({ location_type: 'business_venue' })).toBeNull();
  });

  it('returns null for legacy rows with no snapshot', () => {
    expect(resolveStaffBookingLocation({ location_type: null })).toBeNull();
    expect(resolveStaffBookingLocation({})).toBeNull();
  });

  it('returns null for an unrecognised location type rather than guessing', () => {
    expect(resolveStaffBookingLocation({ location_type: 'somewhere_else' })).toBeNull();
  });

  describe('client address', () => {
    const full = {
      location_type: 'client_address',
      client_address_line1: '12 High Street',
      client_address_line2: 'Flat 2',
      client_address_city: 'Belfast',
      client_address_postcode: 'BT1 1AA',
    };

    it('builds a one-line address and a maps link', () => {
      const view = resolveStaffBookingLocation(full)!;
      expect(view.kind).toBe('client_address');
      expect(view.address).toBe('12 High Street, Flat 2, Belfast, BT1 1AA');
      expect(view.gap).toBe('none');
      expect(view.mapsUrl).toContain('google.com/maps');
      // Spaces and commas must survive as encoded query, not break the link.
      expect(view.mapsUrl).toContain('12+High+Street');
      expect(view.mapsUrl).toContain('BT1+1AA');
    });

    it('skips blank address parts', () => {
      const view = resolveStaffBookingLocation({ ...full, client_address_line2: '   ' })!;
      expect(view.address).toBe('12 High Street, Belfast, BT1 1AA');
    });

    it('flags an address that was never recorded, with no maps link to a blank search', () => {
      const view = resolveStaffBookingLocation({ location_type: 'client_address' })!;
      expect(view.address).toBeNull();
      expect(view.mapsUrl).toBeNull();
      expect(view.gap).toBe('address_not_recorded');
    });

    it('distinguishes an address hidden by linked-venue permissions from one never recorded', () => {
      const view = resolveStaffBookingLocation({
        location_type: 'client_address',
        addressHidden: true,
      })!;
      expect(view.gap).toBe('address_hidden');
    });

    it('does not claim an address is hidden when one is actually present', () => {
      const view = resolveStaffBookingLocation({ ...full, addressHidden: true })!;
      expect(view.gap).toBe('none');
      expect(view.address).toBe('12 High Street, Flat 2, Belfast, BT1 1AA');
    });
  });

  describe('online', () => {
    it('carries the join link and joining information', () => {
      const view = resolveStaffBookingLocation({
        location_type: 'online',
        online_meeting_url: 'https://zoom.us/j/123',
        online_meeting_info: 'Camera on please.',
      })!;
      expect(view.kind).toBe('online');
      expect(view.joinUrl).toBe('https://zoom.us/j/123');
      expect(view.joinInfo).toBe('Camera on please.');
      expect(view.gap).toBe('none');
      expect(view.mapsUrl).toBeNull();
    });

    it('flags an online service with no link configured', () => {
      const view = resolveStaffBookingLocation({ location_type: 'online' })!;
      expect(view.joinUrl).toBeNull();
      expect(view.gap).toBe('no_link');
    });

    it('treats a whitespace-only link or info as absent', () => {
      const view = resolveStaffBookingLocation({
        location_type: 'online',
        online_meeting_url: '   ',
        online_meeting_info: '  ',
      })!;
      expect(view.joinUrl).toBeNull();
      expect(view.joinInfo).toBeNull();
      expect(view.gap).toBe('no_link');
    });

    it('shows joining information even when the link is missing', () => {
      const view = resolveStaffBookingLocation({
        location_type: 'online',
        online_meeting_info: 'Dial in on the usual number.',
      })!;
      expect(view.joinInfo).toBe('Dial in on the usual number.');
      expect(view.gap).toBe('no_link');
    });
  });
});

describe('staffBookingLocationPillLabel', () => {
  it('is short enough for a collapsed row', () => {
    expect(staffBookingLocationPillLabel('online')).toBe('Online');
    expect(staffBookingLocationPillLabel('client_address')).toBe('Client address');
  });
});
