import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultCommunicationPolicies, type CommunicationMessageKey } from '@/lib/communications/policies';

/**
 * The defaults a new venue starts with live in TWO places that must agree:
 *
 *   * `venues.communication_policies` has a NOT NULL column DEFAULT, which is what a new
 *     venue row actually gets on insert.
 *   * `buildDefaultLanePolicies()` is the code fallback, used when the column is absent and
 *     to fill in keys the column default does not list.
 *
 * A venue whose stored blob says one thing while the code says another is very hard to
 * diagnose from the dashboard, so the agreement is asserted here rather than assumed.
 */

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');

/** The JSONB literal from the most recent migration that sets the column default. */
function latestColumnDefault(): Record<string, Record<string, unknown>> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  let latest: string | null = null;
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    if (/communication_policies\s+jsonb\s+NOT NULL DEFAULT/i.test(sql) ||
        /ALTER COLUMN communication_policies SET DEFAULT/i.test(sql)) {
      latest = sql;
    }
  }
  if (!latest) throw new Error('no migration sets the communication_policies column default');
  const start = latest.indexOf("'{");
  const end = latest.lastIndexOf("}'::jsonb");
  if (start === -1 || end === -1) throw new Error('could not extract the JSONB default literal');
  return JSON.parse(latest.slice(start + 1, end + 1));
}

describe('deposit message defaults for a new venue', () => {
  const code = defaultCommunicationPolicies();

  const expected: Record<string, { enabled: boolean; channels: string[] }> = {
    // Asks the guest to pay a deposit: reach them both ways.
    deposit_payment_request: { enabled: true, channels: ['email', 'sms'] },
    // A receipt, not a nudge: email only.
    deposit_confirmation: { enabled: true, channels: ['email'] },
    // Was SMS-only, which sent nothing at all at venues without the SMS entitlement,
    // because the resolver strips sms from the channel list for those venues.
    deposit_payment_reminder: { enabled: true, channels: ['email', 'sms'] },
  };

  for (const lane of ['table', 'appointments_other'] as const) {
    for (const [key, want] of Object.entries(expected)) {
      it(`${lane}: ${key} is ${want.enabled ? 'on' : 'off'} for ${want.channels.join(' + ')}`, () => {
        const policy = code[lane][key as CommunicationMessageKey];
        expect(policy.enabled).toBe(want.enabled);
        expect([...policy.channels].sort()).toEqual([...want.channels].sort());
      });
    }
  }
});

describe('confirm or cancel prompt defaults for a new venue', () => {
  const code = defaultCommunicationPolicies();
  const column = latestColumnDefault();

  for (const lane of ['table', 'appointments_other'] as const) {
    it(`${lane}: the prompt is on, email only, 24 hours before, in code and in the column default`, () => {
      const inCode = code[lane].confirm_or_cancel_prompt;
      expect(inCode.enabled).toBe(true);
      expect(inCode.channels).toEqual(['email']);
      expect(inCode.hoursBefore).toBe(24);

      const stored = column[lane].confirm_or_cancel_prompt as {
        enabled: boolean;
        channels: string[];
        hoursBefore: number | null;
      };
      expect(stored.enabled).toBe(true);
      expect(stored.channels).toEqual(['email']);
      expect(stored.hoursBefore).toBe(24);
    });
  }
});

describe('the column default and the code default agree', () => {
  const code = defaultCommunicationPolicies();
  const column = latestColumnDefault();

  for (const lane of ['table', 'appointments_other'] as const) {
    it(`${lane}: every key the column default lists matches the code default`, () => {
      const laneColumn = column[lane];
      expect(laneColumn, `column default has no "${lane}" lane`).toBeTruthy();
      const mismatches: string[] = [];
      for (const [key, stored] of Object.entries(laneColumn)) {
        const inCode = code[lane][key as CommunicationMessageKey];
        if (!inCode) {
          mismatches.push(`${key}: in the column default but not in the code default`);
          continue;
        }
        const s = stored as { enabled: boolean; channels: string[]; hoursBefore: number | null; hoursAfter: number | null };
        if (s.enabled !== inCode.enabled) {
          mismatches.push(`${key}.enabled: column ${s.enabled}, code ${inCode.enabled}`);
        }
        if ([...s.channels].sort().join() !== [...inCode.channels].sort().join()) {
          mismatches.push(`${key}.channels: column [${s.channels}], code [${inCode.channels}]`);
        }
        if (s.hoursBefore !== inCode.hoursBefore) {
          mismatches.push(`${key}.hoursBefore: column ${s.hoursBefore}, code ${inCode.hoursBefore}`);
        }
        if (s.hoursAfter !== inCode.hoursAfter) {
          mismatches.push(`${key}.hoursAfter: column ${s.hoursAfter}, code ${inCode.hoursAfter}`);
        }
      }
      expect(mismatches).toEqual([]);
    });
  }

  it('lists the deposit reminder as email + SMS in the column default too', () => {
    for (const lane of ['table', 'appointments_other'] as const) {
      const stored = column[lane].deposit_payment_reminder as { channels: string[] };
      expect([...stored.channels].sort()).toEqual(['email', 'sms']);
    }
  });
});
