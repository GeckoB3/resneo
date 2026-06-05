import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LINKED_NOTIFICATION_PREFS,
  classifyCrossVenueWrite,
  resolveLinkedNotificationPrefs,
} from './notification-prefs';

describe('resolveLinkedNotificationPrefs', () => {
  it('defaults every category off (a new link is quiet until the venue opts in)', () => {
    expect(DEFAULT_LINKED_NOTIFICATION_PREFS).toEqual({
      cancel: false,
      reschedule: false,
      create: false,
      notes: false,
    });
  });

  it('returns the defaults for null / non-object input', () => {
    expect(resolveLinkedNotificationPrefs(null)).toEqual(DEFAULT_LINKED_NOTIFICATION_PREFS);
    expect(resolveLinkedNotificationPrefs(undefined)).toEqual(DEFAULT_LINKED_NOTIFICATION_PREFS);
    expect(resolveLinkedNotificationPrefs('nope')).toEqual(DEFAULT_LINKED_NOTIFICATION_PREFS);
    expect(resolveLinkedNotificationPrefs([])).toEqual(DEFAULT_LINKED_NOTIFICATION_PREFS);
  });

  it('merges a partial blob over the defaults', () => {
    expect(resolveLinkedNotificationPrefs({ create: true })).toEqual({
      cancel: false,
      reschedule: false,
      create: true,
      notes: false,
    });
  });

  it('ignores non-boolean and unknown keys', () => {
    expect(
      resolveLinkedNotificationPrefs({ cancel: 'yes', notes: 1, bogus: true }),
    ).toEqual(DEFAULT_LINKED_NOTIFICATION_PREFS);
  });

  it('lets a venue turn everything off', () => {
    expect(
      resolveLinkedNotificationPrefs({ cancel: false, reschedule: false, create: false, notes: false }),
    ).toEqual({ cancel: false, reschedule: false, create: false, notes: false });
  });
});

describe('classifyCrossVenueWrite', () => {
  const a = { booking_date: '2026-06-01', booking_time: '10:00' };

  it('maps cancel and create directly', () => {
    expect(classifyCrossVenueWrite('cancelled_booking', a, null)).toBe('cancel');
    expect(classifyCrossVenueWrite('created_booking', null, a)).toBe('create');
  });

  it('treats a date/time change as a reschedule', () => {
    expect(
      classifyCrossVenueWrite('edited_booking', a, { booking_date: '2026-06-02', booking_time: '10:00' }),
    ).toBe('reschedule');
    expect(
      classifyCrossVenueWrite('edited_booking', a, { booking_date: '2026-06-01', booking_time: '11:00' }),
    ).toBe('reschedule');
  });

  it('treats an unchanged-schedule edit as a notes edit', () => {
    expect(classifyCrossVenueWrite('edited_booking', a, { ...a })).toBe('notes');
  });

  it('returns null for deletes and unknown actions (no email)', () => {
    expect(classifyCrossVenueWrite('deleted_booking', a, null)).toBeNull();
    expect(classifyCrossVenueWrite('viewed_booking', a, a)).toBeNull();
  });
});
