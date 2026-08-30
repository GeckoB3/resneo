/**
 * Tolerant readers and writers for `user_profiles.notification_preferences`
 * (P0-13, R2 half).
 *
 * THE PROBLEM. One free-form jsonb column holds two unrelated preference sets.
 * The staff app writes `new_booking`, `quiet_hours_start` and nine others; the
 * customer portal writes `operational_email` and `marketing_email`. They sit in
 * the same flat object, so a customer profile save can clobber a dual-role
 * user's staff push settings, and linked accounts actively create dual-role
 * users. P0-13 namespaces the column as `{ staff: {...}, customer: {...} }`.
 *
 * THE SEAM. That migration (R3) rewrites the jsonb in place and BREAKS IN BOTH
 * DIRECTIONS. A flat reader against a namespaced blob finds none of its keys
 * and returns defaults for every one. A namespaced reader against a flat blob
 * does exactly the same. `parseStaffNotificationPrefs` is handed the whole
 * column, so this is not theoretical: on either side of that migration, a
 * mismatched reader silently turns every staff push preference into its
 * default, and the next save writes those defaults back as if the user had
 * chosen them.
 *
 * There is no ordering of code and migration that avoids this, which is why the
 * only safe order is TOLERANT CODE, then migration, then narrowed writer, and
 * why this module ships a release ahead of the migration it exists for. It must
 * be live on production before R3 runs, and once R3 has run it must not be
 * reverted.
 *
 * Everything here is pure and total: no throws, no I/O. An unrecognised shape
 * reads as an empty bag rather than an error, because the caller is usually
 * deciding whether to send someone a notification and has nothing useful to do
 * with an exception.
 */

export type PreferenceNamespace = 'staff' | 'customer';

export type PreferenceBag = Record<string, unknown>;

/**
 * The staff key set, which is what routes an incoming patch to a namespace.
 *
 * Deliberately duplicated from `StaffNotificationPrefs` rather than derived
 * from it: this list is a WIRE contract with build 1.0.7, and it must not
 * silently change when someone adds a field to the type. A key added to the
 * type and not to this list simply keeps going to the customer namespace,
 * which is visible and fixable; a key that moves namespace under an existing
 * client is not.
 */
export const STAFF_PREFERENCE_KEYS: readonly string[] = [
  'push_enabled',
  'new_booking',
  'cancellation',
  'reschedule',
  'payment',
  'no_show',
  'waitlist',
  'daily_summary',
  'review',
  'low_sms_credit',
  'billing',
  'booking_scope',
  'quiet_hours_enabled',
  'quiet_hours_start',
  'quiet_hours_end',
];

const STAFF_KEY_SET = new Set(STAFF_PREFERENCE_KEYS);

/** True for a plain object. `typeof null === 'object'`, hence the first test. */
function isPlainObject(value: unknown): value is PreferenceBag {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asBag(value: unknown): PreferenceBag {
  return isPlainObject(value) ? value : {};
}

/**
 * True once the column has been namespaced.
 *
 * Detected by the presence of a `staff` or `customer` OBJECT rather than by a
 * version marker, because R3 rewrites rows in place and a marker would need its
 * own backfill with the same seam problem. A flat blob cannot collide with
 * this: neither `staff` nor `customer` is a preference key on either side.
 */
export function isNamespaced(raw: unknown): boolean {
  const bag = asBag(raw);
  return isPlainObject(bag.staff) || isPlainObject(bag.customer);
}

/**
 * Read one namespace out of the column, whichever shape it is in.
 *
 * Before R3 the flat blob IS both namespaces, so a flat read is returned for
 * either. That is correct rather than a compromise: the flat blob really does
 * hold both key sets, and each reader picks out the keys it knows.
 */
export function readPreferenceNamespace(raw: unknown, namespace: PreferenceNamespace): PreferenceBag {
  const bag = asBag(raw);
  if (isNamespaced(bag)) return asBag(bag[namespace]);
  return bag;
}

/**
 * Merge a patch into one namespace, preserving everything else.
 *
 * MERGE, never replace. `PATCH /api/account/profile` used to assign the
 * incoming object straight onto the column, so a customer client that sent
 * only its own two keys erased every staff preference in the same row.
 *
 * In the namespaced world the other namespace is untouched by construction. In
 * the flat world the patch is merged over the flat blob, which preserves the
 * other side's keys for the same reason.
 */
export function mergePreferenceNamespace(
  raw: unknown,
  namespace: PreferenceNamespace,
  patch: PreferenceBag,
): PreferenceBag {
  const bag = asBag(raw);
  if (isNamespaced(bag)) {
    return { ...bag, [namespace]: { ...asBag(bag[namespace]), ...patch } };
  }
  return { ...bag, ...patch };
}

/**
 * Split an incoming patch by which namespace owns each key, and merge both
 * halves.
 *
 * This is what lets build 1.0.7 keep working after R3 without an app release.
 * It PATCHes flat staff keys, exactly as it always has, and they are routed
 * into `staff` here rather than landing at the top level where no reader would
 * find them.
 *
 * Keys not in the staff set go to `customer`. That is a judgement, not a
 * derivation: the staff key set is fixed and enumerated, the customer surface
 * is the one that gains keys, and putting an unknown key somewhere a reader
 * will look beats stranding it at the top level.
 */
export function mergeIncomingPreferences(raw: unknown, patch: PreferenceBag): PreferenceBag {
  const staffPatch: PreferenceBag = {};
  const customerPatch: PreferenceBag = {};
  for (const [key, value] of Object.entries(patch)) {
    // A client that already sends namespaced objects is taken at its word.
    if (key === 'staff' || key === 'customer') continue;
    if (STAFF_KEY_SET.has(key)) staffPatch[key] = value;
    else customerPatch[key] = value;
  }

  let next = asBag(raw);
  const explicitStaff = asBag(patch.staff);
  const explicitCustomer = asBag(patch.customer);

  if (Object.keys(staffPatch).length > 0 || patch.staff !== undefined) {
    next = mergePreferenceNamespace(next, 'staff', { ...staffPatch, ...explicitStaff });
  }
  if (Object.keys(customerPatch).length > 0 || patch.customer !== undefined) {
    next = mergePreferenceNamespace(next, 'customer', { ...customerPatch, ...explicitCustomer });
  }
  return next;
}

/**
 * The column as build 1.0.7 needs to read it: the namespaced object with the
 * staff keys ALSO mirrored at the top level (§5D.0 B7).
 *
 * 1.0.7 reads `notification_preferences.new_booking` and friends directly. The
 * moment R3 lands, those keys move into `staff` and the shipped app reads a
 * default for every one, shows the user toggles that do not reflect reality,
 * and writes those defaults back on the next save. The mirror costs a dozen
 * duplicated keys in one response and removes that entirely.
 *
 * Retire it only when telemetry shows 1.0.7 is gone, or alongside a coordinated
 * app release. Before R3 it is a no-op, because the column is already flat.
 */
export function withStaffMirror(raw: unknown): PreferenceBag {
  const bag = asBag(raw);
  if (!isNamespaced(bag)) return bag;
  const staff = asBag(bag.staff);
  const mirror: PreferenceBag = {};
  for (const key of STAFF_PREFERENCE_KEYS) {
    if (staff[key] !== undefined) mirror[key] = staff[key];
  }
  return { ...bag, ...mirror };
}
