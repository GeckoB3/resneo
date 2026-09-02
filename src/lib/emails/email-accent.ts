/**
 * The colour customer emails paint their buttons, links and highlights with.
 *
 * A venue that has switched on "Use my brand colour in customer emails" (Booking page settings)
 * supplies its contrast-checked brand colour as `VenueEmailData.brand_colour`; every other venue,
 * and every platform email, gets the ResNeo navy.
 */
export const DEFAULT_EMAIL_ACCENT = '#003B6F';

export function emailAccent(brandColour?: string | null): string {
  const c = brandColour?.trim();
  return c ? c : DEFAULT_EMAIL_ACCENT;
}
