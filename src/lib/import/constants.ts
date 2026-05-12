/** ReserveNI import: target field definitions (aligned with Docs design). */

export type FieldType =
  | 'text'
  | 'email'
  | 'phone'
  | 'date'
  | 'time'
  | 'number'
  | 'boolean'
  | 'currency'
  | 'tags';

export interface SchemaField {
  key: string;
  label: string;
  required: boolean;
  type: FieldType;
  examples?: string[];
}

export const CLIENT_FIELDS: SchemaField[] = [
  { key: 'first_name', label: 'First Name', required: true, type: 'text', examples: ['Sarah', 'John'] },
  { key: 'last_name', label: 'Surname', required: true, type: 'text', examples: ['Jones', 'Smith'] },
  /** Single-column full name from exports; import splits into first/last when first/last are empty. */
  { key: 'full_name', label: 'Full Name', required: false, type: 'text' },
  {
    key: 'external_client_id',
    label: 'External client ID (from your previous system)',
    required: false,
    type: 'text',
  },
  {
    key: 'external_system_id',
    label: 'External system ID',
    required: false,
    type: 'text',
  },
  { key: 'email', label: 'Email Address', required: false, type: 'email', examples: ['sarah@email.com'] },
  { key: 'phone', label: 'Phone Number', required: false, type: 'phone', examples: ['+447891234567'] },
  { key: 'landline', label: 'Landline', required: false, type: 'phone' },
  { key: 'address', label: 'Address', required: false, type: 'text' },
  { key: 'postcode', label: 'Postcode', required: false, type: 'text' },
  { key: 'date_of_birth', label: 'Date of Birth', required: false, type: 'date' },
  { key: 'gender', label: 'Gender', required: false, type: 'text' },
  { key: 'marketing_consent', label: 'Marketing Consent', required: false, type: 'boolean' },
  { key: 'sms_marketing_consent', label: 'SMS marketing consent', required: false, type: 'boolean' },
  { key: 'email_marketing_consent', label: 'Email marketing consent', required: false, type: 'boolean' },
  { key: 'sms_reminder_consent', label: 'SMS reminder consent', required: false, type: 'boolean' },
  { key: 'email_reminder_consent', label: 'Email reminder consent', required: false, type: 'boolean' },
  { key: 'preferred_staff', label: 'Preferred staff', required: false, type: 'text' },
  { key: 'client_since', label: 'Client since', required: false, type: 'date' },
  { key: 'archived', label: 'Archived', required: false, type: 'boolean' },
  { key: 'banned', label: 'Banned', required: false, type: 'boolean' },
  { key: 'loyalty_points', label: 'Loyalty points', required: false, type: 'number' },
  { key: 'credit_balance', label: 'Credit balance (£)', required: false, type: 'currency' },
  { key: 'first_visit_date', label: 'First Visit Date', required: false, type: 'date' },
  { key: 'last_visit_date', label: 'Last Visit Date', required: false, type: 'date' },
  { key: 'total_visits', label: 'Total Visits', required: false, type: 'number' },
  { key: 'total_spent', label: 'Total Spent (£)', required: false, type: 'currency' },
  { key: 'notes', label: 'Client Notes', required: false, type: 'text' },
  { key: 'tags', label: 'Tags', required: false, type: 'tags', examples: ['VIP', 'VIP,Regular'] },
];

export const BOOKING_FIELDS: SchemaField[] = [
  {
    key: 'client_email',
    label: 'Client Email',
    required: false,
    type: 'email',
    examples: ['sarah@email.com'],
  },
  {
    key: 'client_external_id',
    label: 'Client ID (external)',
    required: false,
    type: 'text',
    examples: ['Client ID from your previous system'],
  },
  { key: 'party_size', label: 'Party size / covers', required: false, type: 'number' },
  { key: 'client_phone', label: 'Client Phone', required: false, type: 'phone' },
  { key: 'guest_first_name', label: 'Guest First Name', required: false, type: 'text' },
  { key: 'guest_last_name', label: 'Guest Surname', required: false, type: 'text' },
  {
    key: 'guest_full_name',
    label: 'Guest Full Name',
    required: false,
    type: 'text',
    examples: ['Sarah Jones'],
  },
  {
    key: 'external_appointment_id',
    label: 'Appointment ID (external)',
    required: false,
    type: 'text',
  },
  {
    key: 'external_booking_id',
    label: 'Booking ID (external)',
    required: false,
    type: 'text',
  },
  { key: 'group_booking_id', label: 'Group booking ID', required: false, type: 'text' },
  { key: 'service_name', label: 'Service Name', required: false, type: 'text' },
  { key: 'staff_name', label: 'Staff Member', required: false, type: 'text' },
  { key: 'booking_date', label: 'Booking Date', required: true, type: 'date' },
  { key: 'booking_time', label: 'Booking Time', required: true, type: 'time' },
  { key: 'booking_end_time', label: 'End Time', required: false, type: 'time' },
  { key: 'duration_minutes', label: 'Duration (minutes)', required: false, type: 'number' },
  { key: 'status', label: 'Booking Status', required: false, type: 'text' },
  { key: 'activation_state', label: 'Activation state', required: false, type: 'text', examples: ['ACTIVE', 'CANCELED'] },
  { key: 'confirmed', label: 'Confirmed', required: false, type: 'boolean' },
  { key: 'appointment_source', label: 'Appointment source', required: false, type: 'text' },
  { key: 'room_id', label: 'Room ID', required: false, type: 'text' },
  { key: 'machine_id', label: 'Machine ID', required: false, type: 'text' },
  { key: 'course_name', label: 'Course name', required: false, type: 'text' },
  { key: 'colour_notes', label: 'Colour notes', required: false, type: 'text' },
  { key: 'service_notes', label: 'Service notes', required: false, type: 'text' },
  { key: 'price', label: 'Price (£)', required: false, type: 'currency' },
  { key: 'deposit_amount', label: 'Deposit amount (£)', required: false, type: 'currency' },
  { key: 'deposit_paid', label: 'Deposit paid', required: false, type: 'boolean' },
  {
    key: 'deposit_status',
    label: 'Deposit status',
    required: false,
    type: 'text',
    examples: ['Paid', 'Pending', 'Refunded', 'Not Required'],
  },
  { key: 'notes', label: 'Booking Notes', required: false, type: 'text' },
  { key: 'deleted', label: 'Deleted row', required: false, type: 'boolean' },
  { key: 'table_ref', label: 'Table', required: false, type: 'text' },
  { key: 'event_name', label: 'Event name', required: false, type: 'text' },
  { key: 'class_name', label: 'Class name', required: false, type: 'text' },
  { key: 'resource_name', label: 'Resource', required: false, type: 'text' },
];

export const CLIENT_FIELD_KEYS = new Set(CLIENT_FIELDS.map((f) => f.key));
export const BOOKING_FIELD_KEYS = new Set(BOOKING_FIELDS.map((f) => f.key));

export type PlatformId =
  | 'fresha'
  | 'booksy'
  | 'vagaro'
  | 'resdiary'
  | 'timely'
  | 'phorest'
  | 'unknown';

export const FIELD_ALIASES: Record<string, Record<string, string>> = {
  fresha_clients: {
    'Client Surname': 'Client Last Name',
  },
  vagaro_clients: {
    Surname: 'Last Name',
  },
  timely_clients: {
    'Client surname': 'Client last name',
  },
  phorest_clients: {
    Surname: 'Last Name',
    'Family Name': 'Last Name',
  },
};

export const PLATFORM_SIGNATURES: Record<
  Exclude<PlatformId, 'unknown'>,
  { columns: string[]; filenames: string[] }
> = {
  fresha: {
    columns: [
      'Client First Name',
      'Client Last Name',
      'Client Mobile',
      'Client Email',
      'Appointment Date',
      'Appointment Time',
      'Service Name',
      'Staff Member',
    ],
    filenames: ['fresha', 'shedul'],
  },
  booksy: {
    columns: ['Customer Name', 'Customer Phone', 'Customer Email', 'Service', 'Employee', 'Date', 'Start Time'],
    filenames: ['booksy'],
  },
  vagaro: {
    columns: ['First Name', 'Last Name', 'Cell Phone', 'Email', 'Service Date', 'Service Name', 'Provider'],
    filenames: ['vagaro'],
  },
  resdiary: {
    columns: ['Guest Name', 'Guest Email', 'Guest Phone', 'Covers', 'Reservation Date', 'Reservation Time', 'Table'],
    filenames: ['resdiary', 'res_diary'],
  },
  timely: {
    columns: ['Client first name', 'Client last name', 'Client email', 'Mobile', 'Appointment start', 'Service'],
    filenames: ['timely'],
  },
  phorest: {
    columns: [
      'Appointment ID',
      'Client ID',
      'First Name',
      'Last Name',
      'Appointment Date',
      'Start Time',
      'Service Name',
      'Staff Name',
      'Mobile',
      'Email',
    ],
    filenames: ['phorest', 'staff appointment', 'future appointment'],
  },
};

/** Direct column → ReserveNI field templates when a platform is detected. */
export const PLATFORM_MAPPINGS: Record<string, Record<string, string>> = {
  fresha_clients: {
    'Client First Name': 'first_name',
    'Client Last Name': 'last_name',
    'Client Surname': 'last_name',
    'Client Mobile': 'phone',
    'Client Email': 'email',
    'Date of Birth': 'date_of_birth',
    'Client Notes': 'notes',
    'Total Visits': 'total_visits',
    'Marketing Consent': 'marketing_consent',
    Tags: 'tags',
  },
  fresha_bookings: {
    'Client Email': 'client_email',
    'Appointment Date': 'booking_date',
    'Appointment Time': 'booking_time',
    'Service Name': 'service_name',
    'Staff Member': 'staff_name',
    Duration: 'duration_minutes',
    Status: 'status',
    Price: 'price',
  },
  booksy_clients: {
    'Customer Name': 'full_name',
    'Customer Phone': 'phone',
    'Customer Email': 'email',
  },
  booksy_bookings: {
    'Customer Email': 'client_email',
    'Customer Phone': 'client_phone',
    'Customer Name': 'guest_full_name',
    Service: 'service_name',
    Employee: 'staff_name',
    Date: 'booking_date',
    'Start Time': 'booking_time',
  },
  vagaro_clients: {
    'First Name': 'first_name',
    'Last Name': 'last_name',
    Surname: 'last_name',
    'Cell Phone': 'phone',
    Email: 'email',
  },
  vagaro_bookings: {
    Email: 'client_email',
    'Cell Phone': 'client_phone',
    'Service Date': 'booking_date',
    'Service Name': 'service_name',
    Provider: 'staff_name',
  },
  resdiary_clients: {
    'Guest Name': 'full_name',
    'Guest Email': 'email',
    'Guest Phone': 'phone',
  },
  resdiary_bookings: {
    'Guest Email': 'client_email',
    'Guest Phone': 'client_phone',
    'Guest Name': 'guest_full_name',
    'Reservation Date': 'booking_date',
    'Reservation Time': 'booking_time',
    Covers: 'party_size',
  },
  timely_clients: {
    'Client first name': 'first_name',
    'Client last name': 'last_name',
    'Client surname': 'last_name',
    'Client email': 'email',
    Mobile: 'phone',
  },
  timely_bookings: {
    'Client email': 'client_email',
    Mobile: 'client_phone',
    'Appointment start': 'booking_date',
    Service: 'service_name',
  },
  phorest_clients: {
    'Client ID': 'external_client_id',
    'External Id': 'external_system_id',
    'First Name': 'first_name',
    'Last Name': 'last_name',
    Surname: 'last_name',
    'Family Name': 'last_name',
    Mobile: 'phone',
    Landline: 'landline',
    Email: 'email',
    'Birth Date': 'date_of_birth',
    Gender: 'gender',
    Notes: 'notes',
    'SMS Marketing Consent': 'sms_marketing_consent',
    'Email Marketing Consent': 'email_marketing_consent',
    'SMS Reminder Consent': 'sms_reminder_consent',
    'Email Reminder Consent': 'email_reminder_consent',
    'Street Address 1': 'address',
    'Postal Code': 'postcode',
    'First Visit': 'first_visit_date',
    'Last Visit': 'last_visit_date',
    'Preferred Staff Id': 'preferred_staff',
  },
  phorest_bookings: {
    'Appointment ID': 'external_appointment_id',
    'Booking ID': 'external_booking_id',
    'Group Booking ID': 'group_booking_id',
    'Client ID': 'client_external_id',
    'First Name': 'guest_first_name',
    'Last Name': 'guest_last_name',
    Surname: 'guest_last_name',
    'Client Name': 'guest_full_name',
    'Appointment Date': 'booking_date',
    'Start Time': 'booking_time',
    'End Time': 'booking_end_time',
    'Service Name': 'service_name',
    'Staff Name': 'staff_name',
    State: 'status',
    'Activation State': 'activation_state',
    Source: 'appointment_source',
    'Room Id': 'room_id',
    'Machine Id': 'machine_id',
    'Course Name': 'course_name',
    Notes: 'notes',
    'Colour Notes': 'colour_notes',
    'Service Notes': 'service_notes',
    'Deposit Amount': 'deposit_amount',
    Deleted: 'deleted',
    Price: 'price',
    Duration: 'duration_minutes',
  },
};

export function detectPlatform(
  headers: string[],
  filename: string,
): { platform: PlatformId; score: number } {
  const norm = (s: string) => s.trim().toLowerCase();
  const headerSet = new Set(headers.map((h) => norm(h)));
  const fname = norm(filename);

  let best: PlatformId = 'unknown';
  let bestScore = 0;

  for (const pid of Object.keys(PLATFORM_SIGNATURES) as Exclude<PlatformId, 'unknown'>[]) {
    const sig = PLATFORM_SIGNATURES[pid];
    let score = 0;
    for (const c of sig.columns) {
      if (headerSet.has(norm(c))) score += 1;
    }
    for (const f of sig.filenames) {
      if (fname.includes(f)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = pid;
    }
  }

  const sigForBest = best !== 'unknown' ? PLATFORM_SIGNATURES[best as Exclude<PlatformId, 'unknown'>] : null;
  const columnMatches = sigForBest
    ? sigForBest.columns.filter((c) => headerSet.has(norm(c))).length
    : 0;

  if (columnMatches < 3 && best !== 'unknown') {
    return { platform: 'unknown', score: 0 };
  }

  return { platform: bestScore >= 3 ? best : 'unknown', score: bestScore };
}

export function platformTemplateKey(
  platform: PlatformId,
  fileType: 'clients' | 'bookings' | 'staff' | 'unknown',
): string | null {
  if (platform === 'unknown') return null;
  if (fileType === 'clients') return `${platform}_clients`;
  if (fileType === 'bookings') return `${platform}_bookings`;
  return null;
}
