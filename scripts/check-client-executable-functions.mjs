/**
 * Fails if the set of client-executable SECURITY DEFINER functions in `public`
 * has changed.
 *
 * Background. Hosted Supabase grants anon and authenticated EXECUTE on functions
 * created in `public` by default, and PostgreSQL grants EXECUTE to PUBLIC on top
 * of that. Neither is removable via ALTER DEFAULT PRIVILEGES on this platform
 * (see supabase/migrations/20270108120000), so a new SECURITY DEFINER function
 * is anon-callable the moment it is created unless its migration says otherwise.
 * That is how C0 happened: `admin_hard_delete_venue` was callable by anyone
 * holding the publishable key, and roughly 28 migrations tried to close this
 * class of hole with `REVOKE ... FROM PUBLIC`, which does not touch the direct
 * role grants and closed nothing. It went unnoticed for months because nothing
 * was checking.
 *
 * This is that check. It compares the live set against ALLOWLIST below and fails
 * on any difference, in either direction:
 *
 *   UNEXPECTED - a function a client role can execute that is not allowlisted.
 *                Either add the missing REVOKE to its migration, or, if it is
 *                genuinely meant to be client-callable, confirm it authorises
 *                the caller itself and then add it here in the same PR.
 *
 *   MISSING    - an allowlisted function a client role can no longer execute.
 *                Usually a DROP+CREATE, which resets a function's ACL. On one of
 *                the RLS helpers this strips the `authenticated` grant that every
 *                policy referencing it needs, and the dashboard goes empty rather
 *                than erroring. Re-grant in the same migration.
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY, from the
 * environment or .env.local. Runs against whichever project those point at.
 *
 * Usage:
 *   npm run check:function-grants
 *   node scripts/check-client-executable-functions.mjs
 */

import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env.local') });

/**
 * The 13 functions a client role is allowed to execute. The first 12 were
 * verified 2026-08-13; `link_guest_calendar_allows` was added 2026-08-14 with
 * the N4 migration.
 *
 * The 8 RLS helpers are invoked inside policy evaluation as the querying role,
 * so revoking them locks every user out of the dashboard. They are parameterised
 * on the caller's own identity and return empty for anon.
 *
 * The 4 auth.uid()-scoped functions each take ZERO parameters and derive their
 * target solely from auth.uid(), with an explicit null check. There is no
 * argument through which a signed-in user could name another account. That was
 * confirmed by reading all four bodies, not assumed from their names.
 *
 * Anything else executable by anon or authenticated is a finding. Adding a name
 * here is a security decision and should be reviewed as one.
 */
const ALLOWLIST = new Set([
  // RLS helpers, invoked during policy evaluation
  'caller_staff_admin_venue_ids',
  'caller_staff_venue_ids',
  'current_staff_venue_ids',
  // 20270202130000: the collectives the caller hosts or is a member of, and
  // whether a combined page is live and public. Both exist because the
  // venue_collectives / venue_collective_members staff policies recurse into
  // each other, so a policy on another table cannot subquery them directly.
  // Read-only, parameterised on the caller's identity or on public state.
  'current_staff_collective_ids',
  'collective_is_public_catalog',
  'get_linked_booking_source',
  'link_action_grant',
  'link_calendar_allows',
  'link_calendar_grant',
  // N4 (20270111120000): scopes `linked_venue_can_view_guests` to guests with a
  // booking on a calendar the link covers. Same shape as the helpers above --
  // parameterised on the caller's own identity, returns false for anon.
  'link_guest_calendar_allows',
  'link_pii_grant',
  // auth.uid()-scoped, zero-parameter, called by signed-in users
  'cancel_account_deletion',
  'claim_user_account',
  'request_account_deletion',
  'touch_user_last_active',
]);

// Sets process.exitCode rather than calling process.exit(), so the supabase
// client's keep-alive sockets unwind on their own. Calling process.exit() here
// tears them down mid-flight and trips a libuv assertion on Windows, which
// surfaces as exit code 127 -- indistinguishable from "command not found" in CI.
async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const secret = process.env.SUPABASE_SECRET_KEY?.trim();

  if (!url || !secret) {
    console.error('FAIL  NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are required.');
    console.error('      Set them in .env.local, or in the environment for CI.');
    return 1;
  }

  const db = createClient(url, secret, { auth: { persistSession: false } });
  const { data, error } = await db.rpc('audit_client_executable_functions');

  if (error) {
    console.error(`FAIL  Could not run the audit: ${error.code ?? ''} ${error.message}`);
    if (error.code === 'PGRST202' || /does not exist|schema cache/i.test(error.message)) {
      console.error('      Apply supabase/migrations/20270109120000_audit_client_executable_functions.sql');
    }
    return 1;
  }

  const project = new URL(url).hostname.split('.')[0];
  const live = new Map((data ?? []).map((r) => [r.function_name, r]));

  const unexpected = [...live.keys()].filter((n) => !ALLOWLIST.has(n)).sort();
  const missing = [...ALLOWLIST].filter((n) => !live.has(n)).sort();

  console.log(
    `project ${project}: ${live.size} client-executable SECURITY DEFINER function(s) in public\n`,
  );

  if (unexpected.length) {
    console.error(`UNEXPECTED (${unexpected.length}) - reachable by a client role, not allowlisted:`);
    for (const n of unexpected) {
      const r = live.get(n);
      const roles = [r.anon_execute && 'anon', r.authenticated_execute && 'authenticated']
        .filter(Boolean)
        .join(', ');
      console.error(`  ${r.signature}   [${roles}]`);
    }
    console.error('');
  }

  if (missing.length) {
    console.error(`MISSING (${missing.length}) - allowlisted but no longer client-executable:`);
    for (const n of missing) console.error(`  ${n}`);
    console.error('  An RLS helper here means the dashboard is about to return empty results.\n');
  }

  if (unexpected.length || missing.length) {
    console.error('FAIL  The client-executable function set has drifted from the allowlist.');
    console.error('      See the header of this file for what each direction means.');
    return 1;
  }

  console.log(`PASS  Matches the allowlist of ${ALLOWLIST.size}.`);
  return 0;
}

process.exitCode = await main();
