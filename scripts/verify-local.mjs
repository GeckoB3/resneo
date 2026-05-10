#!/usr/bin/env node
/**
 * Run with: node scripts/verify-local.mjs
 * Requires the dev server to be running (npm run dev) and .env.local with
 * NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY set.
 */
const BASE = 'http://localhost:3000';

async function get(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    redirect: 'manual',
    ...opts,
  });
  return { status: res.status, location: res.headers.get('location') };
}

async function main() {
  console.log('Verifying local dev server (ensure npm run dev is running)...\n');

  const tests = [
    ['GET /', 200],
    ['GET /login', 200],
    ['GET /dashboard (unauthenticated)', 'redirect-to-login'],
  ];

  let ok = 0;
  for (const [name, expected] of tests) {
    const path = name.includes('dashboard') ? '/dashboard' : name.split(' ')[1];
    const { status, location } = await get(path);
    const pass =
      expected === 'redirect-to-login'
        ? (status === 302 || status === 307) && location?.includes('/login')
        : status === expected;
    if (pass) {
      console.log(`  ✓ ${name} → ${status}${location ? ` → ${location}` : ''}`);
      ok++;
    } else {
      const expectedMsg = expected === 'redirect-to-login' ? '302/307 → /login' : expected;
      console.log(`  ✗ ${name} → got ${status}${location ? ` (${location})` : ''}, expected ${expectedMsg}`);
    }
  }

  console.log(`\n${ok}/${tests.length} checks passed.`);
  if (ok < tests.length) {
    console.log('Ensure .env.local has NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
