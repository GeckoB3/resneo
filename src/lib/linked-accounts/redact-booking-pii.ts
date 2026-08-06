/**
 * Redaction for booking rows served to a linked venue without the PII grant (§5.2).
 *
 * This exists because the two surfaces that serve linked viewers each redacted a
 * *derived* object (the joined guest record) and then returned the raw booking row
 * alongside it, which carries its own copy of the client's name, contact details
 * and free text. The redaction and the payload drifted apart, so the guard was
 * applied and defeated in the same response.
 *
 * Keep the field list here rather than at the call sites: any new PII column on
 * `bookings` needs adding in exactly one place.
 */

/**
 * Booking columns that identify or describe the client.
 *
 * `special_requests`, `dietary_notes` and `occasion` are client-authored free text.
 * They routinely carry names, and dietary notes carry health and religious
 * information, so they are treated as identifying regardless of how innocuous a
 * particular value looks.
 *
 * `internal_notes` is the host venue's private staff commentary. It is withheld
 * here for the same reason, though whether a linked venue should see it *even
 * with* the PII grant is a separate policy question and is not decided by this file.
 */
export const BOOKING_PII_FIELDS = [
  'guest_first_name',
  'guest_last_name',
  'guest_email',
  'guest_phone',
  'special_requests',
  'dietary_notes',
  'occasion',
  'internal_notes',
] as const;

export type BookingPiiField = (typeof BOOKING_PII_FIELDS)[number];

/**
 * Returns a copy of `booking` with every {@link BOOKING_PII_FIELDS} value nulled.
 * Fields absent from the input stay absent, so this never widens a payload.
 */
export function redactBookingPiiFields<T extends Record<string, unknown>>(booking: T): T {
  const out = { ...booking };
  for (const field of BOOKING_PII_FIELDS) {
    if (field in out) {
      (out as Record<string, unknown>)[field] = null;
    }
  }
  return out;
}

/**
 * Communication log rows carry the delivery address in `recipient`, which is the
 * client's email address or phone number in plain text. Redact it alongside the
 * booking fields; the rest of the row (channel, status, timestamps) is operational
 * and is what a linked venue legitimately needs to see.
 */
export function redactCommunicationRecipients<T extends { recipient?: string | null }>(
  rows: readonly T[],
): T[] {
  return rows.map((row) => ('recipient' in row ? { ...row, recipient: null } : { ...row }));
}

/**
 * True when the caller is a linked venue whose grant does not include PII.
 * Own-venue staff are never redacted.
 */
export function linkedViewerMustNotSeePii(
  isOwnVenue: boolean,
  linkedGrant: { pii?: boolean } | null | undefined,
): boolean {
  return !isOwnVenue && Boolean(linkedGrant) && !linkedGrant?.pii;
}
