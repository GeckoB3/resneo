/**
 * Deterministic column-name → Resneo field aliases.
 *
 * Most real exports use predictable header names ("Start Time", "Mobile",
 * "Stylist"…). Matching them deterministically — before/independent of the AI —
 * makes the common case instant and exact, so the user usually only has to
 * confirm. Alias matches are stored as confirmed mappings (ai_suggested=false,
 * confidence=high) and take precedence over AI guesses for the same column.
 */

export type AliasFileType = 'clients' | 'bookings' | 'staff';

export interface AliasMapping {
  source_column: string;
  target_field: string;
}

/** Lowercase, collapse any run of non-alphanumerics to a single space, trim. */
export function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Ordered alias lists per file type. Earlier entries win when two headers would
 * claim the same field. Keys are already in normalized form (see normalizeHeader).
 */
const CLIENT_ALIASES: Record<string, string> = {
  'first name': 'first_name',
  forename: 'first_name',
  'given name': 'first_name',
  'christian name': 'first_name',
  'last name': 'last_name',
  surname: 'last_name',
  'family name': 'last_name',
  'full name': 'full_name',
  name: 'full_name',
  'client name': 'full_name',
  'customer name': 'full_name',
  'contact name': 'full_name',
  email: 'email',
  'email address': 'email',
  'e mail': 'email',
  phone: 'phone',
  'phone number': 'phone',
  mobile: 'phone',
  'mobile number': 'phone',
  'mobile phone': 'phone',
  cell: 'phone',
  'cell phone': 'phone',
  telephone: 'phone',
  'contact number': 'phone',
  landline: 'landline',
  'home phone': 'landline',
  dob: 'date_of_birth',
  'date of birth': 'date_of_birth',
  'birth date': 'date_of_birth',
  birthday: 'date_of_birth',
  gender: 'gender',
  sex: 'gender',
  address: 'address',
  'street address': 'address',
  'address 1': 'address',
  'address line 1': 'address',
  postcode: 'postcode',
  'post code': 'postcode',
  zip: 'postcode',
  'zip code': 'postcode',
  notes: 'notes',
  'client notes': 'notes',
  comments: 'notes',
  tags: 'tags',
  'marketing consent': 'marketing_consent',
};

const BOOKING_ALIASES: Record<string, string> = {
  'appointment date': 'booking_date',
  'booking date': 'booking_date',
  date: 'booking_date',
  'service date': 'booking_date',
  'reservation date': 'booking_date',
  'visit date': 'booking_date',
  'appointment time': 'booking_time',
  'booking time': 'booking_time',
  'start time': 'booking_time',
  time: 'booking_time',
  'reservation time': 'booking_time',
  'start': 'booking_time',
  'end time': 'booking_end_time',
  'finish time': 'booking_end_time',
  duration: 'duration_minutes',
  'duration minutes': 'duration_minutes',
  'duration mins': 'duration_minutes',
  length: 'duration_minutes',
  service: 'service_name',
  'service name': 'service_name',
  treatment: 'service_name',
  'treatment name': 'service_name',
  staff: 'staff_name',
  'staff member': 'staff_name',
  'staff name': 'staff_name',
  stylist: 'staff_name',
  therapist: 'staff_name',
  provider: 'staff_name',
  employee: 'staff_name',
  practitioner: 'staff_name',
  technician: 'staff_name',
  operator: 'staff_name',
  'client email': 'client_email',
  'customer email': 'client_email',
  'guest email': 'client_email',
  email: 'client_email',
  'client phone': 'client_phone',
  'customer phone': 'client_phone',
  'guest phone': 'client_phone',
  mobile: 'client_phone',
  phone: 'client_phone',
  cell: 'client_phone',
  telephone: 'client_phone',
  'client name': 'guest_full_name',
  'customer name': 'guest_full_name',
  'guest name': 'guest_full_name',
  name: 'guest_full_name',
  'full name': 'guest_full_name',
  'first name': 'guest_first_name',
  forename: 'guest_first_name',
  'last name': 'guest_last_name',
  surname: 'guest_last_name',
  'party size': 'party_size',
  covers: 'party_size',
  guests: 'party_size',
  pax: 'party_size',
  party: 'party_size',
  status: 'status',
  'booking status': 'status',
  'appointment status': 'status',
  price: 'price',
  amount: 'price',
  cost: 'price',
  total: 'price',
  notes: 'notes',
  'booking notes': 'notes',
  comments: 'notes',
  table: 'table_ref',
  'table number': 'table_ref',
  'table ref': 'table_ref',
};

const STAFF_ALIASES: Record<string, string> = {
  name: 'staff_name',
  'staff name': 'staff_name',
  'staff member': 'staff_name',
  'full name': 'staff_name',
  'employee name': 'staff_name',
  'first name': 'staff_first_name',
  forename: 'staff_first_name',
  'last name': 'staff_last_name',
  surname: 'staff_last_name',
  email: 'staff_email',
  'email address': 'staff_email',
  phone: 'staff_phone',
  mobile: 'staff_phone',
  cell: 'staff_phone',
  telephone: 'staff_phone',
  role: 'staff_role',
  'job title': 'staff_role',
  title: 'staff_role',
  position: 'staff_role',
};

function aliasesFor(fileType: AliasFileType): Record<string, string> {
  if (fileType === 'bookings') return BOOKING_ALIASES;
  if (fileType === 'staff') return STAFF_ALIASES;
  return CLIENT_ALIASES;
}

/**
 * Deterministically map the given headers to fields by exact normalized-name
 * match. Each target field is claimed by at most one header (first wins), so
 * duplicates ("Mobile" and "Phone") are left for the AI / manual mapping.
 */
export function aliasMapColumns(headers: string[], fileType: AliasFileType): AliasMapping[] {
  const table = aliasesFor(fileType);
  const usedFields = new Set<string>();
  const out: AliasMapping[] = [];
  for (const header of headers) {
    if (!header?.trim()) continue;
    const field = table[normalizeHeader(header)];
    if (!field || usedFields.has(field)) continue;
    usedFields.add(field);
    out.push({ source_column: header, target_field: field });
  }
  return out;
}
