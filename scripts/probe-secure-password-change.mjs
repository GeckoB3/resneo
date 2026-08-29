/**
 * Does `secure_password_change` actually close the hole AD7 needs closed?
 *
 * RUN THIS BEFORE COMMITTING TO OPTION A. The plan makes the project-level
 * setting a prerequisite for P3-4b's limited sessions, on the assumption that
 * turning it on stops a limited session changing the account's password. That
 * assumption has never been tested. `supabase/config.toml:218` documents the
 * setting as "users need to reauthenticate **or have logged in recently**",
 * and a limited session is by construction a FRESH login: P3-4c mints it with
 * `generateLink` + `verifyOtp` at the moment the customer clicks. If the
 * recency exemption applies, the setting does not defend the one case it was
 * chosen for.
 *
 * It answers three questions, and each changes a different decision:
 *
 *   1. ORDINARY SESSION. Does the setting bite at all on a normal password
 *      change? If not, it is not switched on for this project.
 *   2. FRESH SESSION (AD7's case). Can a session minted seconds ago change the
 *      password with no nonce? **If YES, option A does not buy what AD7 needs**
 *      and the limited-session boundary cannot be closed this way.
 *   3. RECOVERY SESSION. Can a `type=recovery` session set a password with no
 *      nonce? **If NO, turning the setting on BREAKS FORGOT-PASSWORD** for
 *      staff and customers, which is the flow used by the people least able to
 *      cope with it: `login-form.tsx:140` sends the reset, `/auth/confirm`
 *      routes it to `/auth/set-password`, and that posts to
 *      `/api/account/password`, which is the very endpoint this setting guards.
 *
 * WRITES NOTHING you care about: it creates one throwaway user, acts as that
 * user, and deletes it at the end, including on failure. It changes no project
 * settings; flipping the toggle is a human decision and stays one.
 *
 * Run it TWICE, once with the setting off and once with it on, and compare.
 * The off run is the control: if case 1 does not change between the two runs,
 * the toggle did not take effect and nothing else in the output means anything.
 *
 *   node scripts/probe-secure-password-change.mjs
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY and one of
 * NEXT_PUBLIC_SUPABASE_ANON_KEY / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.
 * Point them at STAGING. It prints no secrets.
 */
import { createClient } from '@supabase/supabase-js';

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

  // ── 1. Ordinary session. The control. ──────────────────────────────────
  const ordinary = await changePasswordWithNoNonce(
    await passwordSession(FIRST_PASSWORD),
    `${FIRST_PASSWORD}-one`,
  );
  report(
    '1. ORDINARY SESSION (signed in with a password)',
    ordinary,
    (accepted) =>
      accepted
        ? 'the setting is OFF, or does not bite here. If you flipped it, it has not taken effect and nothing below is evidence.'
        : 'the setting is ON and biting. Every password-change surface needs a nonce step before this can ship.',
    { isControl: true },
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
