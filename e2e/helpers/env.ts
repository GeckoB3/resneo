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
  const baseURL =
    process.env.E2E_BASE_URL?.trim() ??
    process.env.NEXT_PUBLIC_BASE_URL?.trim() ??
    'http://localhost:3000';

  return {
    venueSlug,
    venueName,
    serviceName,
    baseURL,
    paymentTokenSecret: process.env.PAYMENT_TOKEN_SECRET?.trim() ?? '',
    isConfigured: Boolean(venueSlug),
  };
}
