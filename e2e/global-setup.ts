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
}
