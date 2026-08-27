import { describe, it, expect } from 'vitest';
import {
  isNamespaced,
  mergeIncomingPreferences,
  mergePreferenceNamespace,
  readPreferenceNamespace,
  withStaffMirror,
} from '@/lib/notifications/notification-preferences';
import {
  DEFAULT_STAFF_NOTIFICATION_PREFS,
  parseStaffNotificationPrefs,
} from '@/lib/push/staff-notification-prefs';

/**
 * P0-13's R2 half. This is the one seam in Phase 0 with no revert: R3 rewrites
 * the jsonb in place, and a reader on the wrong side of it does not fail
 * loudly, it returns defaults for every key and then writes them back as if the
 * user had chosen them.
 *
 * So every test here runs against BOTH shapes. The flat fixture is what
 * production holds today; the namespaced one is what R3 produces.
 */

const FLAT = {
  // Staff keys, written by build 1.0.7.
  push_enabled: true,
  new_booking: false,
  quiet_hours_enabled: true,
  quiet_hours_start: '22:00',
  booking_scope: 'mine',
  // Customer keys, written by the portal, in the same object.
  operational_email: false,
  marketing_email: true,
};

const NAMESPACED = {
  staff: {
    push_enabled: true,
    new_booking: false,
    quiet_hours_enabled: true,
    quiet_hours_start: '22:00',
    booking_scope: 'mine',
  },
  customer: {
    operational_email: false,
    marketing_email: true,
  },
};

describe('isNamespaced', () => {
  it('tells the two shapes apart', () => {
    expect(isNamespaced(FLAT)).toBe(false);
    expect(isNamespaced(NAMESPACED)).toBe(true);
    expect(isNamespaced({ staff: {} })).toBe(true);
    expect(isNamespaced({ customer: {} })).toBe(true);
  });

  it('is not fooled by junk in those keys', () => {
    // A detector that accepted these would route writes into a string.
    expect(isNamespaced({ staff: 'yes' })).toBe(false);
    expect(isNamespaced({ staff: null })).toBe(false);
    expect(isNamespaced({ staff: ['a'] })).toBe(false);
    expect(isNamespaced(null)).toBe(false);
    expect(isNamespaced('nope')).toBe(false);
    expect(isNamespaced([])).toBe(false);
  });
});

describe('readPreferenceNamespace', () => {
  it('reads the same values from either shape', () => {
    for (const [label, raw] of [['flat', FLAT], ['namespaced', NAMESPACED]] as const) {
      expect(readPreferenceNamespace(raw, 'customer').operational_email, label).toBe(false);
      expect(readPreferenceNamespace(raw, 'staff').new_booking, label).toBe(false);
      expect(readPreferenceNamespace(raw, 'staff').quiet_hours_start, label).toBe('22:00');
    }
  });

  it('returns an empty bag rather than throwing on anything unexpected', () => {
    for (const junk of [null, undefined, 'x', 42, []]) {
      expect(readPreferenceNamespace(junk, 'staff')).toEqual({});
    }
  });
});

describe('parseStaffNotificationPrefs across the seam', () => {
  it('reads the SAME preferences from the flat and namespaced shapes', () => {
    // The single most important assertion in this file. If these ever diverge,
    // R3 turns every staff push preference into its default.
    expect(parseStaffNotificationPrefs(FLAT)).toEqual(parseStaffNotificationPrefs(NAMESPACED));
  });

  it('honours a user who turned new bookings off, in either shape', () => {
    for (const raw of [FLAT, NAMESPACED]) {
      const prefs = parseStaffNotificationPrefs(raw);
      expect(prefs.new_booking).toBe(false);
      expect(prefs.booking_scope).toBe('mine');
      expect(prefs.quiet_hours_start).toBe('22:00');
    }
  });

  it('does NOT read customer keys as staff preferences', () => {
    // The collision that motivates the namespace: two key sets in one object.
    const customerOnly = { operational_email: false, marketing_email: true };
    expect(parseStaffNotificationPrefs(customerOnly)).toEqual(DEFAULT_STAFF_NOTIFICATION_PREFS);
  });

  it('still falls back to defaults for a genuinely empty column', () => {
    expect(parseStaffNotificationPrefs({})).toEqual(DEFAULT_STAFF_NOTIFICATION_PREFS);
    expect(parseStaffNotificationPrefs(null)).toEqual(DEFAULT_STAFF_NOTIFICATION_PREFS);
  });
});

describe('mergePreferenceNamespace', () => {
  it('PRESERVES the other namespace when writing one, in either shape', () => {
    // The live defect: a customer save wiped a dual-role user's staff prefs.
    const flatNext = mergePreferenceNamespace(FLAT, 'customer', { marketing_email: false });
    expect(parseStaffNotificationPrefs(flatNext).new_booking).toBe(false);
    expect(readPreferenceNamespace(flatNext, 'customer').marketing_email).toBe(false);

    const nsNext = mergePreferenceNamespace(NAMESPACED, 'customer', { marketing_email: false });
    expect(parseStaffNotificationPrefs(nsNext).new_booking).toBe(false);
    expect(readPreferenceNamespace(nsNext, 'customer').marketing_email).toBe(false);
  });

  it('keeps the shape it was given', () => {
    expect(isNamespaced(mergePreferenceNamespace(FLAT, 'staff', { review: true }))).toBe(false);
    expect(isNamespaced(mergePreferenceNamespace(NAMESPACED, 'staff', { review: true }))).toBe(true);
  });

  it('does not mutate its input', () => {
    const before = JSON.stringify(NAMESPACED);
    mergePreferenceNamespace(NAMESPACED, 'staff', { review: true });
    expect(JSON.stringify(NAMESPACED)).toBe(before);
  });

  it('creates the namespace when only the other one exists', () => {
    const next = mergePreferenceNamespace({ staff: { review: true } }, 'customer', {
      marketing_email: true,
    });
    expect(readPreferenceNamespace(next, 'customer').marketing_email).toBe(true);
    expect(readPreferenceNamespace(next, 'staff').review).toBe(true);
  });
});

describe('mergeIncomingPreferences (what the PATCH does)', () => {
  it('routes flat staff keys into staff, which is how 1.0.7 survives R3', () => {
    // The shipped app PATCHes flat keys and will keep doing so. After R3 they
    // must land where the staff reader looks, not at the top level.
    const next = mergeIncomingPreferences(NAMESPACED, { new_booking: true, review: true });
    expect(parseStaffNotificationPrefs(next).new_booking).toBe(true);
    expect(parseStaffNotificationPrefs(next).review).toBe(true);
    // And the customer side is untouched.
    expect(readPreferenceNamespace(next, 'customer').marketing_email).toBe(true);
    // Nothing was stranded at the top level, where no reader would find it.
    expect(Object.keys(next).sort()).toEqual(['customer', 'staff']);
  });

  it('routes customer keys into customer without touching staff', () => {
    const next = mergeIncomingPreferences(NAMESPACED, { marketing_email: false });
    expect(readPreferenceNamespace(next, 'customer').marketing_email).toBe(false);
    expect(parseStaffNotificationPrefs(next)).toEqual(parseStaffNotificationPrefs(NAMESPACED));
  });

  it('a CUSTOMER-ONLY patch cannot erase staff preferences, in either shape', () => {
    // Exactly the reported defect. The route used to assign the incoming
    // object straight onto the column.
    for (const [label, raw] of [['flat', FLAT], ['namespaced', NAMESPACED]] as const) {
      const next = mergeIncomingPreferences(raw, {
        operational_email: true,
        marketing_email: false,
      });
      const prefs = parseStaffNotificationPrefs(next);
      expect(prefs.new_booking, label).toBe(false);
      expect(prefs.quiet_hours_start, label).toBe('22:00');
      expect(prefs.booking_scope, label).toBe('mine');
    }
  });

  it('a STAFF-ONLY patch cannot erase customer preferences, in either shape', () => {
    for (const [label, raw] of [['flat', FLAT], ['namespaced', NAMESPACED]] as const) {
      const next = mergeIncomingPreferences(raw, { new_booking: true });
      expect(readPreferenceNamespace(next, 'customer').marketing_email, label).toBe(true);
      expect(readPreferenceNamespace(next, 'customer').operational_email, label).toBe(false);
    }
  });

  it('takes an explicitly namespaced patch at its word', () => {
    const next = mergeIncomingPreferences(NAMESPACED, { staff: { review: true } });
    expect(parseStaffNotificationPrefs(next).review).toBe(true);
    expect(parseStaffNotificationPrefs(next).new_booking).toBe(false);
  });

  it('leaves the column alone for an empty patch', () => {
    expect(mergeIncomingPreferences(NAMESPACED, {})).toEqual(NAMESPACED);
  });

  it('starts from nothing without throwing', () => {
    const next = mergeIncomingPreferences(null, { marketing_email: true });
    expect(readPreferenceNamespace(next, 'customer').marketing_email).toBe(true);
  });
});

describe('withStaffMirror (§5D.0 B7)', () => {
  it('lets a FLAT reader see staff keys after the column is namespaced', () => {
    // Build 1.0.7 does exactly this: reads the keys off the top level.
    const mirrored = withStaffMirror(NAMESPACED) as Record<string, unknown>;
    expect(mirrored.new_booking).toBe(false);
    expect(mirrored.quiet_hours_start).toBe('22:00');
    expect(mirrored.booking_scope).toBe('mine');
    // Without the mirror, a shipped build reads undefined and shows defaults.
    expect((NAMESPACED as Record<string, unknown>).new_booking).toBeUndefined();
  });

  it('keeps the namespaces intact, so a new client reads the real shape', () => {
    const mirrored = withStaffMirror(NAMESPACED);
    expect(isNamespaced(mirrored)).toBe(true);
    expect(parseStaffNotificationPrefs(mirrored)).toEqual(parseStaffNotificationPrefs(NAMESPACED));
  });

  it('does NOT mirror customer keys, which 1.0.7 has no use for', () => {
    const mirrored = withStaffMirror(NAMESPACED) as Record<string, unknown>;
    expect(mirrored.marketing_email).toBeUndefined();
  });

  it('is a no-op before R3', () => {
    expect(withStaffMirror(FLAT)).toEqual(FLAT);
  });
});
