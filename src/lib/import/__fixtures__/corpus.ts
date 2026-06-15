/**
 * Import eval corpus: synthetic but provider-faithful export files used to
 * pin the deterministic pipeline (ingest → detect → profile → map → normalise)
 * in CI, and to score AI column mapping offline (scripts/eval-import-ai.ts).
 *
 * Each fixture is intentionally messy in a way real exports are messy.
 */

export interface CorpusFixture {
  name: string;
  filename: string;
  fileType: 'clients' | 'bookings';
  csv: string;
  /** Expected platform from detectPlatform (null = unknown). */
  expectedPlatform: string | null;
  /** Golden column → ResNeo field expectations for AI/template mapping evals. */
  expectedMappings: Record<string, string>;
}

export const CORPUS: CorpusFixture[] = [
  {
    name: 'Fresha clients export',
    filename: 'fresha_clients_export.csv',
    fileType: 'clients',
    expectedPlatform: 'fresha',
    csv: [
      'Client First Name,Client Last Name,Client Mobile,Client Email,Date of Birth,Total Visits,Marketing Consent,Tags',
      'Sarah,Jones,07725 002233,sarah.jones@example.com,14/03/1985,12,Yes,"VIP,Colour"',
      "Siân,O'Neill,+353 87 123 4567,sian@example.ie,02/11/1990,3,No,",
      'John,Smith,07725002234,,25/12/1979,1,Yes,Regular',
    ].join('\n'),
    expectedMappings: {
      'Client First Name': 'first_name',
      'Client Last Name': 'last_name',
      'Client Mobile': 'phone',
      'Client Email': 'email',
      'Date of Birth': 'date_of_birth',
      'Total Visits': 'total_visits',
      'Marketing Consent': 'marketing_consent',
      Tags: 'tags',
    },
  },
  {
    name: 'Phorest future appointments export',
    filename: 'phorest_future_appointments.csv',
    fileType: 'bookings',
    expectedPlatform: 'phorest',
    csv: [
      'Appointment ID,Client ID,First Name,Last Name,Appointment Date,Start Time,End Time,Service Name,Staff Name,Mobile,Email,State,Deposit Amount,Price',
      'APPT-1001,CL-501,Sarah,Jones,14/07/2026,09:30,10:15,Cut & Blow Dry,Megan,07725 002233,sarah.jones@example.com,BOOKED,10.00,45.00',
      'APPT-1002,CL-502,John,Smith,14/07/2026,11:00,12:00,Full Head Colour,Megan,07725002234,,PAID,0,85.00',
      'APPT-1003,CL-501,Sarah,Jones,15/07/2026,14:00,14:45,Cut & Blow Dry,Aoife,07725 002233,sarah.jones@example.com,CANCELED,0,45.00',
    ].join('\n'),
    expectedMappings: {
      'Appointment ID': 'external_appointment_id',
      'Client ID': 'client_external_id',
      'First Name': 'guest_first_name',
      'Last Name': 'guest_last_name',
      'Appointment Date': 'booking_date',
      'Start Time': 'booking_time',
      'End Time': 'booking_end_time',
      'Service Name': 'service_name',
      'Staff Name': 'staff_name',
      Mobile: 'client_phone',
      Email: 'client_email',
      State: 'status',
      'Deposit Amount': 'deposit_amount',
      Price: 'price',
    },
  },
  {
    name: 'Booksy clients with combined name',
    filename: 'booksy-customer-list.csv',
    fileType: 'clients',
    expectedPlatform: 'booksy',
    csv: [
      'Customer Name,Customer Phone,Customer Email,Service,Employee,Date,Start Time',
      'Sarah Jones,07725 002233,sarah.jones@example.com,Gel Nails,Megan,,',
      '"Smith, John",07725002234,john@example.com,Pedicure,Aoife,,',
    ].join('\n'),
    expectedMappings: {
      'Customer Name': 'full_name',
      'Customer Phone': 'phone',
      'Customer Email': 'email',
    },
  },
  {
    name: 'US-format bookings with AM/PM times',
    filename: 'salon_appointments_usa.csv',
    fileType: 'bookings',
    expectedPlatform: null,
    csv: [
      'Client Email,Appt Date,Appt Time,Treatment,Provider Name,Amount',
      'amy@example.com,03/14/2026,2:30 PM,Swedish Massage,Dana,95.00',
      'beth@example.com,03/14/2026,9:00 AM,Hot Stone Massage,Dana,120.00',
      'carl@example.com,12/25/2026,11:15 AM,Swedish Massage,Lee,95.00',
    ].join('\n'),
    expectedMappings: {
      'Client Email': 'client_email',
      'Appt Date': 'booking_date',
      'Appt Time': 'booking_time',
      Treatment: 'service_name',
      'Provider Name': 'staff_name',
      Amount: 'price',
    },
  },
  {
    name: 'EU semicolon CSV with decimal-comma prices and title rows',
    filename: 'kundenliste_export.csv',
    fileType: 'bookings',
    expectedPlatform: null,
    csv: [
      'Terminexport — Studio Schmidt;;;;;',
      'Erstellt: 01.06.2026;;;;;',
      'E-Mail;Datum;Uhrzeit;Behandlung;Mitarbeiter;Preis',
      'lena@example.de;14.07.2026;14:30;Massage;Petra;1.234,56',
      'max@example.de;15.07.2026;09:00;Maniküre;Petra;45,00',
    ].join('\n'),
    expectedMappings: {
      'E-Mail': 'client_email',
      Datum: 'booking_date',
      Uhrzeit: 'booking_time',
      Behandlung: 'service_name',
      Mitarbeiter: 'staff_name',
      Preis: 'price',
    },
  },
  {
    name: 'Timely-style combined datetime',
    filename: 'timely_appointments.csv',
    fileType: 'bookings',
    expectedPlatform: 'timely',
    csv: [
      'Client email,Appointment start,Service,Duration,Price',
      'sarah@example.com,14/07/2026 14:30,Cut,45,38.00',
      'john@example.com,2026-07-15T09:00:00,Beard Trim,15,12.00',
    ].join('\n'),
    expectedMappings: {
      'Client email': 'client_email',
      'Appointment start': 'booking_date',
      Service: 'service_name',
      Duration: 'duration_minutes',
      Price: 'price',
    },
  },
];
