/**
 * P4-3's other acceptance: saving a customer preference must not disturb a
 * dual-role user's staff push settings by so much as a byte.
 *
 * Linked accounts actively create users who are both, and the two preference
 * sets share one free-form jsonb column. Before P0-13 namespaced it, a
 * customer save could clobber staff push; this asserts the namespacing holds
 * for the new matrix specifically, since it is the newest writer.
 */
import { describe, it, expect } from 'vitest';
import { mergePreferenceNamespace } from '@/lib/notifications/notification-preferences';
import { preferenceKey } from '@/lib/notifications/customer-channel-preferences';

describe('a dual-role user saving a booking-message preference', () => {
  it('leaves the staff namespace byte-identical', () => {
    const staff = {
      new_booking: true,
      quiet_hours_start: '22:00',
      quiet_hours_end: '07:00',
      booking_scope: 'own',
      no_show: false,
    };
    const before = { staff: { ...staff }, customer: { marketing_email: true } };
    const beforeStaffBytes = JSON.stringify(before.staff);

    const after = mergePreferenceNamespace(before, 'customer', {
      [preferenceKey('reminders', 'sms')]: false,
    }) as Record<string, unknown>;

    expect(JSON.stringify(after.staff), 'staff preferences were modified').toBe(beforeStaffBytes);
  });

  it('keeps the customer keys it did not touch', () => {
    const before = { staff: { new_booking: true }, customer: { marketing_email: true } };
    const after = mergePreferenceNamespace(before, 'customer', {
      [preferenceKey('reminders', 'sms')]: false,
    }) as Record<string, Record<string, unknown>>;
    expect(after.customer.marketing_email).toBe(true);
    expect(after.customer.reminders_sms).toBe(false);
  });

  it('does not write the customer key into the staff namespace', () => {
    // The failure that would silently re-create the pre-P0-13 collision.
    const before = { staff: { new_booking: true }, customer: {} };
    const after = mergePreferenceNamespace(before, 'customer', {
      [preferenceKey('reminders', 'sms')]: false,
    }) as Record<string, Record<string, unknown>>;
    expect(after.staff).not.toHaveProperty('reminders_sms');
  });
});
