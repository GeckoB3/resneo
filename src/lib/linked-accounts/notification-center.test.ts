import { describe, expect, it } from 'vitest';
import {
  buildNotificationView,
  formatNotificationCopy,
  notificationHref,
  type LinkNotificationRow,
} from './notification-center';

function row(overrides: Partial<LinkNotificationRow>): LinkNotificationRow {
  return {
    id: 'n1',
    type: 'cross_venue_booking_created',
    category: 'cross_venue_write',
    link_id: 'l1',
    collective_id: null,
    actor_venue_id: 'v-actor',
    resource_type: 'booking',
    resource_id: 'b1',
    payload: { actor_venue_name: 'Chair Two', booking_date: '2026-06-10', booking_time: '14:30:00' },
    read_at: null,
    created_at: '2026-06-09T08:00:00Z',
    ...overrides,
  };
}

describe('formatNotificationCopy', () => {
  it('summarises a cross-venue create with date and time', () => {
    const { title, body } = formatNotificationCopy('cross_venue_booking_created', {
      actor_venue_name: 'Chair Two',
      booking_date: '2026-06-10',
      booking_time: '14:30:00',
    });
    expect(title).toBe('New booking from Chair Two');
    expect(body).toContain('2026-06-10 at 14:30');
  });

  it('summarises a cancellation', () => {
    const { title, body } = formatNotificationCopy('cross_venue_booking_cancelled', {
      actor_venue_name: 'Chair Two',
      booking_date: '2026-06-10',
      booking_time: '09:00',
    });
    expect(title).toBe('Booking cancelled by Chair Two');
    expect(body).toContain('cancelled the 2026-06-10 at 09:00 booking');
  });

  it('describes a reschedule with the old → new time when it moved', () => {
    const { title, body } = formatNotificationCopy('cross_venue_booking_edited', {
      actor_venue_name: 'Chair Two',
      booking_date: '2026-06-11',
      booking_time: '15:00',
      old_booking_date: '2026-06-10',
      old_booking_time: '14:30',
    });
    expect(title).toBe('Booking updated by Chair Two');
    expect(body).toContain('from 2026-06-10 at 14:30 to 2026-06-11 at 15:00');
  });

  it('falls back gracefully when the actor name is missing', () => {
    const { title, body } = formatNotificationCopy('cross_venue_booking_created', {});
    expect(title).toBe('New booking from A linked venue');
    expect(body).toBe('A linked venue created a booking in your calendar.');
  });

  it('handles an unknown type without throwing', () => {
    const { title } = formatNotificationCopy('something_new', { actor_venue_name: 'X' });
    expect(title).toBe('Update from X');
  });

  it('prefers a preset title/body from the payload (lifecycle events)', () => {
    const { title, body } = formatNotificationCopy('link_lifecycle', {
      title: 'Riverside Spa accepted your link request',
      body: 'The link is now active.',
    });
    expect(title).toBe('Riverside Spa accepted your link request');
    expect(body).toBe('The link is now active.');
  });
});

describe('notificationHref', () => {
  it('deep-links to the calendar on the booking date', () => {
    expect(notificationHref(row({}))).toBe('/dashboard/calendar?date=2026-06-10');
  });

  it('falls back to the linked-accounts settings tab without a date', () => {
    expect(notificationHref(row({ payload: { actor_venue_name: 'X' } }))).toBe(
      '/dashboard/settings?tab=linked-accounts',
    );
  });
});

describe('buildNotificationView', () => {
  it('marks unread when read_at is null and read when set', () => {
    expect(buildNotificationView(row({ read_at: null })).read).toBe(false);
    expect(buildNotificationView(row({ read_at: '2026-06-09T09:00:00Z' })).read).toBe(true);
  });

  it('carries the actor name and a stable shape through', () => {
    const view = buildNotificationView(row({}));
    expect(view.actorVenueName).toBe('Chair Two');
    expect(view.href).toBe('/dashboard/calendar?date=2026-06-10');
    expect(view.title).toBe('New booking from Chair Two');
    expect(view.createdAt).toBe('2026-06-09T08:00:00Z');
  });
});
