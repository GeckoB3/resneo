/**
 * Does `secure_password_change` actually close the hole AD7 needs closed?
 *
 * **ANSWERED, staging, 2026-08-29: NO.** Recorded here because the result is
 * the point of the script and someone reading it later should not have to
 * re-run it to learn the answer.
 *
 *   0. AGED SESSION (backdated 72h) ..... REFUSED, `reauthentication_needed`
 *   1. RECENT password sign-in .......... ACCEPTED
 *   2. FRESH session via verifyOtp ...... ACCEPTED   <-- a limited session
 *   3. RECOVERY session ................. ACCEPTED
 *
 * So the setting works, and it exempts recent logins exactly as
 * `supabase/config.toml:218` says it does. **A limited session under AD7 is by
 * construction a recent login**: P3-4c mints it with `generateLink` +
 * `verifyOtp` at the instant the customer clicks. Case 2 is that session, and
 * it changed the password with no nonce. Turning this setting on therefore
 * does NOT stop a forwarded confirmation email being turned into account
 * takeover, which is the single thing AD7 made it a prerequisite for.
 *
 * The one piece of good news is case 3: forgot-password survives the toggle,
 * so enabling it would not break `/auth/set-password` for people who cannot
 * sign in. That was the other risk and it is clear.
 *
 * WHY CASE 0 EXISTS. Without it this script cannot tell an enabled setting
 * from a disabled one: every other case holds a session seconds old, and the
 * first version of this probe reported "ACCEPTED" three times with the setting
 * ON and OFF alike, which reads as a finding and is not one. Case 0 is the
 * only control that moves, and the interpretation of 1 to 3 is withheld until
 * it refuses.
 *
 * Re-run it if GoTrue is upgraded, or if the recency window becomes
 * configurable. It creates one throwaway user and deletes it, changes no
 * project settings, and prints no secrets.
 *
 *   npm run probe:secure-password-change
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY and one of
 * NEXT_PUBLIC_SUPABASE_ANON_KEY / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
 * pointed at STAGING, and the `supabase` CLI linked (case 0 shells out to it).
 */
import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const secret = process.env.SUPABASE_SECRET_KEY?.trim();
const anon = (
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  ''
).trim();

if (!url || !secret || !anon) {
  console.error(
    'Set NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY and NEXT_PUBLIC_SUPABASE_ANON_KEY.',
  );
  process.exit(1);
}

const admin = createClient(url, secret, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** A throwaway account, so nothing real is touched. */
const EMAIL = `spc-probe-${Date.now()}@resneo-probe.invalid`;
const FIRST_PASSWORD = `Probe-${Math.random().toString(36).slice(2)}-Aa1!`;

/**
 * Change the password by calling GoTrue DIRECTLY with the access token and no
 * nonce, which is exactly what a browser holding a limited session can do and
 * what no ResNeo route sits in front of. This is the bypass AD7 names, not a
 * simulation of it.
 */
async function changePasswordWithNoNonce(accessToken, newPassword) {
  const res = await fetch(`${url}/auth/v1/user`, {
    method: 'PUT',
    headers: {
      apikey: anon,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ password: newPassword }),
  });
  const body = await res.json().catch(() => ({}));
  return {
    accepted: res.ok,
    status: res.status,
    // GoTrue answers a missing nonce with a specific code; anything else means
    // the call failed for a different reason and the result is not evidence.
    code: body?.error_code ?? body?.code ?? null,
    message: body?.msg ?? body?.message ?? body?.error_description ?? null,
  };
}

/** A session established the way P3-4c will: generateLink, then verifyOtp. */
async function freshSessionViaOtp(type) {
  const { data, error } = await admin.auth.admin.generateLink({
    type,
    email: EMAIL,
    ...(type === 'magiclink' ? {} : {}),
  });
  if (error) throw new Error(`generateLink(${type}) failed: ${error.message}`);
  const tokenHash = data?.properties?.hashed_token;
  if (!tokenHash) throw new Error(`generateLink(${type}) returned no hashed_token`);

  const client = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: verified, error: verifyErr } = await client.auth.verifyOtp({
    type,
    token_hash: tokenHash,
  });
  if (verifyErr) throw new Error(`verifyOtp(${type}) failed: ${verifyErr.message}`);
  const accessToken = verified?.session?.access_token;
  if (!accessToken) throw new Error(`verifyOtp(${type}) returned no session`);
  return accessToken;
}

/** A session from an ordinary email + password sign-in. */
async function passwordSession(password) {
  const client = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email: EMAIL, password });
  if (error) throw new Error(`signInWithPassword failed: ${error.message}`);
  return data.session.access_token;
}

/**
 * Backdate this probe user's sessions so they are no longer "recent".
 *
 * WHY THIS EXISTS, and it is the whole point of the probe. GoTrue's own config
 * comment says the setting demands a nonce unless the user has "logged in
 * recently", so every case above uses a session seconds old and CANNOT tell an
 * enabled setting from a disabled one. Ageing a session is the only way to
 * observe the setting at all without waiting a day.
 *
 * IT WRITES TO `auth.sessions`, which is Supabase's own schema and which the
 * plan rightly forbids production code from touching. It is confined to the
 * throwaway user this script created and deletes, on staging, in a diagnostic
 * that ships nothing. If that trade is not wanted, delete this case: the other
 * three still run, and they will simply never distinguish on from off.
 */
function ageSessionsOfProbeUser(hours) {
  const sql = `UPDATE auth.sessions
     SET created_at = now() - interval '${hours} hours',
         updated_at = now() - interval '${hours} hours',
         refreshed_at = (now() - interval '${hours} hours')::timestamp
   WHERE user_id = '${userId}';`;
  const file = path.join(os.tmpdir(), `spc-age-${Date.now()}.sql`);
  fs.writeFileSync(file, sql, 'utf8');
  try {
    execFileSync('npx', ['supabase', 'db', 'query', '--linked', '-f', file], {
      stdio: 'pipe',
      shell: process.platform === 'win32',
    });
  } finally {
    fs.rmSync(file, { force: true });
  }
}

/**
 * Case 1 is the CONTROL, and cases 2 and 3 mean nothing until it refuses.
 *
 * With the setting off everything is accepted, which is not evidence about
 * anything: it is what "off" looks like. Printing case 2's conclusion in that
 * state would let someone read "option A does not close AD7's hole" off a run
 * that tested nothing, so the interpretation is withheld until the control
 * says the setting is actually biting.
 */
let settingIsBiting = null;

function report(label, outcome, meaning, { isControl = false } = {}) {
  const verdict = outcome.accepted ? 'ACCEPTED' : `REFUSED (${outcome.status})`;
  console.log(`\n${label}`);
  console.log(`  password change with no nonce: ${verdict}`);
  if (!outcome.accepted) {
    console.log(`  code: ${outcome.code ?? 'none'} | ${outcome.message ?? ''}`);
  }
  if (isControl) {
    settingIsBiting = !outcome.accepted;
    console.log(`  → ${meaning(outcome.accepted)}`);
    return;
  }
  if (!settingIsBiting) {
    console.log(
      '  → NO CONCLUSION: the control says the setting is not on, so this is only what "off" looks like.',
    );
    return;
  }
  console.log(`  → ${meaning(outcome.accepted)}`);
}

let userId = null;
try {
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: EMAIL,
    password: FIRST_PASSWORD,
    email_confirm: true,
  });
  if (createErr) throw new Error(`createUser failed: ${createErr.message}`);
  userId = created.user.id;
  console.log(`probe user created (deleted at the end)\nproject: ${url}`);

  /*
    ── 0. AGED SESSION. The real control. ────────────────────────────────
    Sign in, backdate the session past any plausible recency window, then try
    to change the password. This is the ONLY case that can distinguish the
    setting being on from being off, because every other case here holds a
    session seconds old and the setting exempts recent logins by design.
  */
  const agedToken = await passwordSession(FIRST_PASSWORD);
  ageSessionsOfProbeUser(72);
  const aged = await changePasswordWithNoNonce(agedToken, `${FIRST_PASSWORD}-zero`);
  report(
    '0. AGED SESSION (signed in, then backdated 72 hours)',
    aged,
    (accepted) =>
      accepted
        ? 'the setting is OFF, or does not apply. Nothing below is evidence about it.'
        : 'the setting is ON and biting. Now the cases below mean something.',
    { isControl: true },
  );

  // ── 1. Ordinary session, seconds old. ──────────────────────────────────
  const ordinary = await changePasswordWithNoNonce(
    await passwordSession(FIRST_PASSWORD),
    `${FIRST_PASSWORD}-one`,
  );
  report(
    '1. RECENT SESSION (signed in with a password moments ago)',
    ordinary,
    (accepted) =>
      accepted
        ? 'a RECENT login is exempt. This is the case AD7 depends on being blocked, and it is not.'
        : 'even a recent login needs a nonce, so the exemption does not apply on this project.',
  );

  // ── 2. Fresh session. AD7's actual case. ───────────────────────────────
  const fresh = await changePasswordWithNoNonce(
    await freshSessionViaOtp('magiclink'),
    `${FIRST_PASSWORD}-two`,
  );
  report(
    "2. FRESH SESSION via verifyOtp (what a limited session IS)",
    fresh,
    (accepted) =>
      accepted
        ? 'OPTION A DOES NOT CLOSE AD7 s HOLE. A forwarded email still yields account takeover, because the session is "recently logged in". Do not build P3-4b on this premise.'
        : 'option A holds: a freshly minted session cannot change the password, which is the property AD7 depends on.',
  );

  // ── 3. Recovery session. The blast radius. ─────────────────────────────
  const recovery = await changePasswordWithNoNonce(
    await freshSessionViaOtp('recovery'),
    `${FIRST_PASSWORD}-three`,
  );
  report(
    '3. RECOVERY SESSION (the forgot-password flow)',
    recovery,
    (accepted) =>
      accepted
        ? 'forgot-password survives the toggle: recovery sessions are exempt.'
        : 'TURNING THIS ON BREAKS FORGOT-PASSWORD for staff and customers. /auth/set-password posts to /api/account/password, which is this endpoint. Fix that flow before the toggle, not after.',
  );

  console.log(
    settingIsBiting
      ? '\nThe control refused, so cases 2 and 3 above are real findings. Act on them.'
      : '\nCONTROL RUN ONLY. The setting is off, so nothing above is evidence yet. ' +
          'Flip it on staging and run this again; case 1 CHANGING is what proves it took effect.',
  );
} catch (err) {
  console.error(`\nprobe failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  if (userId) {
    const { error } = await admin.auth.admin.deleteUser(userId);
    console.log(error ? `\nCOULD NOT DELETE probe user ${userId}: ${error.message}` : '\nprobe user deleted');
  }
}
