/**
 * Split combined venue.address (comma-separated) into fields used in Settings / onboarding.
 * Must stay in sync with how {@link buildAddress} joins them.
 */
export function parseAddress(address: string | null): {
  name: string;
  street: string;
  town: string;
  postcode: string;
} {
  if (!address) return { name: '', street: '', town: '', postcode: '' };
  const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
  const postcodeMatch = parts[parts.length - 1]?.match(/^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i);
  if (postcodeMatch && parts.length >= 2) {
    const postcode = parts.pop()!;
    const town = parts.pop() ?? '';
    // What remains is "name, street" when both were saved, or the street alone when the
    // building name was blank. The street is never optional, so a single leftover part is
    // the street, not the name; reading it as the name emptied the Street field on every
    // reload of an address saved without a building name.
    const name = parts.length >= 2 ? parts.shift()! : '';
    const street = parts.join(', ');
    return { name, street, town, postcode };
  }
  if (parts.length >= 4) {
    return {
      name: parts[0]!,
      street: parts[1]!,
      town: parts[2]!,
      postcode: parts.slice(3).join(', '),
    };
  }
  if (parts.length === 3) return { name: '', street: parts[0]!, town: parts[1]!, postcode: parts[2]! };
  if (parts.length === 2) return { name: '', street: parts[0]!, town: parts[1]!, postcode: '' };
  return { name: '', street: address, town: '', postcode: '' };
}

/** Join structured address fields into venues.address (same format as Settings profile). */
export function buildAddress(fields: { name: string; street: string; town: string; postcode: string }): string {
  return [fields.name, fields.street, fields.town, fields.postcode]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(', ');
}
