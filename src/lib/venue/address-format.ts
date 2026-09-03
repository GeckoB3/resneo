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
  // Read by POSITION, never by what a postcode looks like: venues are not only in the UK,
  // and a French "75001" or a US "10001" is as much a postcode as "BT1 1AA". The joined
  // form is "name, street, town, postcode" with the name optional and the street never
  // optional, so: four or more parts carry a name (a street that contains a comma keeps
  // its extra parts); three are street, town, postcode; fewer are the leading fields.
  if (parts.length >= 4) {
    const postcode = parts.pop()!;
    const town = parts.pop()!;
    const name = parts.shift()!;
    return { name, street: parts.join(', '), town, postcode };
  }
  if (parts.length === 3) return { name: '', street: parts[0]!, town: parts[1]!, postcode: parts[2]! };
  if (parts.length === 2) return { name: '', street: parts[0]!, town: parts[1]!, postcode: '' };
  return { name: '', street: parts[0] ?? address.trim(), town: '', postcode: '' };
}

/** Join structured address fields into venues.address (same format as Settings profile). */
export function buildAddress(fields: { name: string; street: string; town: string; postcode: string }): string {
  return [fields.name, fields.street, fields.town, fields.postcode]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(', ');
}
