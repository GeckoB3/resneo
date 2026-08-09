import { config as loadEnv } from 'dotenv';
import { join } from 'path';

loadEnv({ path: join(process.cwd(), '.env.local') });
loadEnv({ path: join(process.cwd(), '.env.e2e') });

/**
 * Validates env for smoke tests. Fixture seeding is manual or via:
 *   node scripts/seed-e2e-smoke-venue.mjs
 */
export default async function globalSetup(): Promise<void> {
  const slug = process.env.E2E_VENUE_SLUG?.trim();
  if (!slug) {
    console.warn(
      '[e2e] E2E_VENUE_SLUG is not set — appointment smoke tests will be skipped. See Docs/E2E_SMOKE.md',
    );
    return;
  }

  const required = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'SUPABASE_SECRET_KEY',
    'STRIPE_SECRET_KEY',
    'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY',
    'PAYMENT_TOKEN_SECRET',
  ] as const;

  const missing = required.filter((key) => !process.env[key]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `[e2e] Missing required env for smoke tests: ${missing.join(', ')}. See Docs/E2E_SMOKE.md`,
    );
  }

  if (!process.env.E2E_STRIPE_CONNECTED_ACCOUNT_ID?.trim()) {
    console.warn(
      '[e2e] E2E_STRIPE_CONNECTED_ACCOUNT_ID is not set — paid booking smoke will fail until Connect is configured on the fixture venue.',
    );
  }

  console.log(`[e2e] Smoke fixture venue slug: ${slug}`);

  const staffFirstSlug = process.env.E2E_STAFF_FIRST_VENUE_SLUG?.trim();
  if (!staffFirstSlug) {
    console.warn(
      '[e2e] E2E_STAFF_FIRST_VENUE_SLUG is not set — staff-first smoke tests will be skipped. Run the seed script and copy the value it prints. See Docs/E2E_SMOKE.md',
    );
  } else if (staffFirstSlug === slug) {
    throw new Error(
      '[e2e] E2E_STAFF_FIRST_VENUE_SLUG and E2E_VENUE_SLUG point at the same venue, so one ordering would be tested twice and the other not at all.',
    );
  } else {
    console.log(`[e2e] Staff-first fixture venue slug: ${staffFirstSlug}`);
  }
}
