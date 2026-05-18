/**
 * Smoke-test cron route handlers (GET, as Vercel Cron invokes them).
 *
 * Usage:
 *   1. Start the app: npm run dev (or npm run start)
 *   2. CRON_SMOKE_BASE_URL=http://127.0.0.1:3000 CRON_SECRET=... node scripts/smoke-cron.mjs
 *
 * In development, CRON_SECRET may be unset (routes allow unauthenticated cron).
 * In production, Vercel sets CRON_SECRET and sends Authorization: Bearer automatically.
 *
 * After deploy: Vercel → Project → Settings → Cron Jobs → each job → View logs (expect 200, not 405/401).
 */

import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env.local') });
config();

const BASE = (process.env.CRON_SMOKE_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const SECRET = process.env.CRON_SECRET?.trim();

const PATHS = [
  '/api/cron/send-communications',
  '/api/cron/deposit-reminder-2h',
  '/api/cron/dietary-digest',
  '/api/cron/auto-cancel-bookings',
  '/api/cron/reconciliation',
  '/api/cron/account-link-maintenance',
];

let exitCode = 0;

for (const path of PATHS) {
  const headers = {};
  if (SECRET) {
    headers['Authorization'] = `Bearer ${SECRET}`;
  }
  try {
    const res = await fetch(`${BASE}${path}`, { headers });
    const text = await res.text();
    console.log(`${path} → ${res.status}`);
    if (res.status === 405) {
      console.error('  405 Method Not Allowed: handler must export GET for Vercel Cron.');
      exitCode = 1;
    }
    if (res.status === 401) {
      console.error('  401: set CRON_SECRET in .env.local to match the Bearer token (required in production).');
      if (process.env.NODE_ENV === 'production') exitCode = 1;
    }
    if (res.status >= 500) {
      console.error('  Body:', text.slice(0, 200));
      exitCode = 1;
    }
  } catch (e) {
    console.error(`${path} → fetch failed:`, e.message);
    exitCode = 1;
  }
}

process.exit(exitCode);
