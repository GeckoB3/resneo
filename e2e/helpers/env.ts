export function requireE2eEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required E2E env: ${name}`);
  }
  return value;
}

export function getE2eConfig() {
  const venueSlug = process.env.E2E_VENUE_SLUG?.trim() ?? '';
  const venueName = process.env.E2E_VENUE_NAME?.trim() ?? 'E2E Smoke Salon';
  const serviceName = process.env.E2E_SERVICE_NAME?.trim() ?? 'E2E Smoke Consultation';
  const optionsServiceName =
    process.env.E2E_OPTIONS_SERVICE_NAME?.trim() ?? 'E2E Smoke Options Consultation';
  const baseURL =
    process.env.E2E_BASE_URL?.trim() ??
    process.env.NEXT_PUBLIC_BASE_URL?.trim() ??
    'http://localhost:3000';

  return {
    venueSlug,
    venueName,
    serviceName,
    optionsServiceName,
    baseURL,
    paymentTokenSecret: process.env.PAYMENT_TOKEN_SECRET?.trim() ?? '',
    isConfigured: Boolean(venueSlug),
  };
}

/**
 * The staff-first fixture, seeded on a fixed slug alongside the default one.
 * Its specs skip unless it is configured, so a checkout that only has the
 * original fixture still runs the rest of the suite.
 */
export function getStaffFirstE2eConfig() {
  const venueSlug = process.env.E2E_STAFF_FIRST_VENUE_SLUG?.trim() ?? '';
  return {
    venueSlug,
    /** Charges less for the shared service, and has the options service. */
    calendarA: process.env.E2E_STAFF_FIRST_CALENDAR_A?.trim() ?? 'E2E Alex',
    /** Charges the base price, and is the only one offering the exclusive service. */
    calendarB: process.env.E2E_STAFF_FIRST_CALENDAR_B?.trim() ?? 'E2E Bailey',
    sharedServiceName:
      process.env.E2E_STAFF_FIRST_SHARED_SERVICE_NAME?.trim() ?? 'E2E Shared Consultation',
    exclusiveServiceName:
      process.env.E2E_STAFF_FIRST_EXCLUSIVE_SERVICE_NAME?.trim() ?? 'E2E Second Calendar Only',
    optionsServiceName:
      process.env.E2E_STAFF_FIRST_OPTIONS_SERVICE_NAME?.trim() ??
      'E2E Staff-First Options Consultation',
    isConfigured: Boolean(venueSlug),
  };
}
