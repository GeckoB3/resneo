import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * P1-4 acceptance: no implementation vocabulary in customer-facing portal copy
 * (closes G19).
 *
 * **Why this is not one grep.** The obvious version, `grep -r Stripe src/app/account`,
 * can never pass: the commerce sections import `loadStripe`, call `useStripe`
 * and pass `stripeAccount` to the SDK, and renaming those would be renaming a
 * third party's API. So this reads only the text a customer can actually see:
 * JSX text nodes and string literals, with comments and imports stripped, and
 * an explicit allowlist for the handful of literals that are data rather than
 * copy. Every allowlist entry carries its reason, because an allowlist without
 * one is just a way to make a test stop complaining.
 *
 * Paired with `portal-copy.spec.ts`, which greps the real rendered DOM. This
 * file catches copy in states the e2e fixture cannot reach (a `past_due`
 * membership, a failed repeat booking); the e2e catches anything this file's
 * extraction misses. Neither is sufficient alone.
 */

/** Everything a customer can read comes from these. */
const UI_DIRS = [
  path.join(process.cwd(), 'src', 'app', 'account'),
  path.join(process.cwd(), 'src', 'components', 'account'),
];

/**
 * The data layer is swept for vocabulary but NOT for enum values. It is the
 * layer whose job is to know them: `account-home.ts` tests membership status
 * against `['active', 'trialing', 'past_due']` to decide what is live, and
 * `account-commerce-copy.ts` exists precisely to hold the mapping. Flagging
 * those would be flagging the fix.
 */
const PORTAL_DIRS = [...UI_DIRS, path.join(process.cwd(), 'src', 'lib', 'account')];

/**
 * The vocabulary the plan bans, plus the raw enum shapes.
 *
 * `Connect` is word-bounded and case-sensitive so it does not match
 * "connected" or "connection" in ordinary prose. `pence` likewise, so
 * `price_pence` in a type is not a match but the word "pence" in a sentence is.
 */
const BANNED: Array<{ pattern: RegExp; why: string }> = [
  { pattern: /\bStripe\b/i, why: 'names the payment processor at a customer' },
  { pattern: /\bConnect(ed)? account\b/i, why: 'Stripe Connect is an implementation detail' },
  { pattern: /\bCDE\b/, why: 'internal shorthand for classes, dining and events' },
  { pattern: /\bcron\b/i, why: 'names a scheduled job at a customer' },
  { pattern: /materialis|materializ/i, why: 'internal word for creating the bookings' },
  { pattern: /\bvenue schedule\b/i, why: 'internal name for the job that books them' },
  { pattern: /\bpence\b/i, why: 'prices are shown in pounds' },
  { pattern: /\bledger\b/i, why: 'accounting word for a list of activity' },
];

/**
 * The stored values this pass stopped showing people.
 *
 * Applied to the UI directories only, and written UNQUOTED. The first version
 * of this required surrounding quotes, which meant it could never fire: the
 * extractor strips a literal's quotes before the pattern ever sees it. A
 * mutation that put `{'past_due'}` back into the memberships row passed, which
 * is how that was found.
 *
 * Only the values that are unambiguously internal are listed. `active` and
 * `paused` are real English words a customer can read without harm, so
 * banning them would be banning ordinary copy.
 */
const BANNED_ENUMS = /\b(past_due|pending_payment|admin_adjust|incomplete_expired|trialing|next_materialize_on)\b/;

/**
 * Literals that match a banned word but are data, not copy.
 *
 * Kept exact and short. Anything added here has to be something a customer
 * cannot read.
 */
const ALLOWED: Array<{ text: string; why: string }> = [
  { text: 'stripe', why: 'the Stripe Elements `appearance.theme` value, an SDK argument' },
];
// A Supabase column list like `fee_pence, charged_pence, ...` needs no entry:
// the patterns are word-bounded, and `_` is a word character, so `fee_pence`
// is not a match while the word "pence" in a sentence is. An allowlist entry
// for it was written first and then removed once a mutation showed it was
// doing nothing, since a dead entry only hides the next real match.

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsxFiles(full));
    else if (/\.tsx?$/.test(entry.name) && !entry.name.includes('.test.')) out.push(full);
  }
  return out;
}

/** Strip comments and import lines: neither reaches a customer. */
function strippedSource(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/^\s*import\s[\s\S]*?from\s+['"].*?['"];?$/gm, ' ');
}

/**
 * Everything a customer might read: string literals and JSX text runs.
 *
 * `className` values are dropped because a Tailwind class list is not copy and
 * would otherwise be the noisiest source of false matches.
 */
function candidateStrings(src: string): string[] {
  const body = strippedSource(src).replace(/className=(\{`[^`]*`\}|"[^"]*"|\{"[^"]*"\})/g, ' ');
  const out: string[] = [];

  for (const m of body.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
    out.push(m[1] ?? m[2] ?? m[3] ?? '');
  }
  // JSX text: a run between `>` and `<`. Runs that look like code rather than
  // prose are dropped, since `a > b && c < d` matches the same shape.
  for (const m of body.matchAll(/>([^<>{}]+)</g)) {
    const text = m[1].trim();
    if (text && /[a-z]/i.test(text) && !/[;=]/.test(text)) out.push(text);
  }

  // What is INSIDE a `${...}` is code, not copy: the customer reads the result,
  // not the expression. Leaving it in reported `£${(pence / 100).toFixed(2)}`
  // as a customer being shown the word "pence", which is the opposite of true.
  // Allowlisting those would have hidden a whole class of real matches, so the
  // extractor is fixed instead.
  return out.map((text) => text.replace(/\$\{[^}]*\}/g, ' '));
}

const rel = (f: string) => path.relative(process.cwd(), f).replace(/\\/g, '/');

describe('P1-4: the portal speaks to customers, not about its plumbing', () => {
  const files = PORTAL_DIRS.flatMap(tsxFiles);
  const allowed = new Set(ALLOWED.map((a) => a.text));

  it('uses no implementation vocabulary in anything a customer can read', () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const text of candidateStrings(fs.readFileSync(file, 'utf8'))) {
        if (allowed.has(text.trim())) continue;
        for (const { pattern, why } of BANNED) {
          if (pattern.test(text)) {
            offenders.push(`${rel(file)}: ${why}\n    ${text.trim().slice(0, 160)}`);
            break;
          }
        }
      }
    }
    expect(offenders, `implementation vocabulary in portal copy:\n${offenders.join('\n')}`).toEqual(
      [],
    );
  });

  it('shows no raw database enum in anything a customer can read', () => {
    const offenders: string[] = [];
    for (const file of UI_DIRS.flatMap(tsxFiles)) {
      for (const text of candidateStrings(fs.readFileSync(file, 'utf8'))) {
        if (BANNED_ENUMS.test(text)) offenders.push(`${rel(file)}: ${text.trim().slice(0, 120)}`);
      }
    }
    expect(offenders, `raw enum values in portal copy:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('renders no status or reason field straight into the page', () => {
    // The shape of the actual defect, caught structurally rather than by
    // guessing every value the column can hold. `{m.status}` in the memberships
    // row is what put `past_due` in front of customers, and a value-based check
    // alone cannot see it, because the value only exists at runtime.
    const offenders: string[] = [];
    for (const file of UI_DIRS.flatMap(tsxFiles)) {
      const src = strippedSource(fs.readFileSync(file, 'utf8'));
      // `(?<!\$)` keeps this to JSX. `` `HTTP ${res.status}` `` in
      // ManageBookingLink is an HTTP response code going into an Error, not a
      // database enum going onto the page, and it is code for the same reason
      // every other `${...}` is.
      for (const m of src.matchAll(/(?<!\$)\{\s*[a-z]\w*\.(status|reason|state)\s*\}/gi)) {
        offenders.push(`${rel(file)}: ${m[0]}`);
      }
    }
    expect(
      offenders,
      'render these through a helper in account-commerce-copy.ts:\n' + offenders.join('\n'),
    ).toEqual([]);
  });

  it('uses no em-dashes, per CLAUDE.md', () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const text of candidateStrings(fs.readFileSync(file, 'utf8'))) {
        if (text.includes('—')) offenders.push(`${rel(file)}: ${text.trim().slice(0, 120)}`);
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('the sweep is not vacuous: it reads real files and can still see text', () => {
    // Without this, a broken extractor or a renamed directory would make every
    // assertion above pass by finding nothing to check.
    expect(files.length).toBeGreaterThan(15);
    const all = files.flatMap((f) => candidateStrings(fs.readFileSync(f, 'utf8')));
    expect(all.length).toBeGreaterThan(500);
    // And it really can see the two shapes it claims to read.
    expect(all.some((t) => t.includes('Memberships are billed by the venue'))).toBe(true);
    expect(all.some((t) => t === 'Your repeat bookings')).toBe(true);
  });

  it('would catch the strings this pass removed', () => {
    // The guard that makes the sweep meaningful: feed it the copy P1-4 deleted
    // and it must object. Without this, a mistake in `candidateStrings` would
    // look exactly like a clean portal.
    const wasReal = [
      'Subscriptions bill on each venue’s Stripe Connect account.',
      'Recurring rule created. The nightly cron will start materialising bookings.',
      'Plans listed here have Stripe prices configured on the venue account.',
      'Recent ledger',
    ];
    for (const text of wasReal) {
      expect(
        BANNED.some(({ pattern }) => pattern.test(text)),
        `the sweep would not have caught: ${text}`,
      ).toBe(true);
    }
    // And the enum sweep, which is separate and was silently dead once.
    for (const value of ['past_due', 'pending_payment', 'admin_adjust']) {
      expect(BANNED_ENUMS.test(value), `the enum sweep would not have caught: ${value}`).toBe(true);
    }
    // Ordinary words that happen to be statuses must NOT be caught, or the
    // sweep would ban plain English.
    for (const word of ['active', 'paused', 'cancelled', 'completed']) {
      expect(BANNED_ENUMS.test(word), `the enum sweep is too broad: ${word}`).toBe(false);
    }
  });
});
