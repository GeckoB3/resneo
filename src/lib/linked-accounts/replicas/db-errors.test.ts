import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { API_ERROR_CODES } from '@/lib/api/error-codes';
import { COLLECTIVE_PREFIXED_CODES, COLLECTIVE_SQLSTATE_CODES, collectiveDbError } from './db-errors';

describe('collectiveDbError', () => {
  it('maps each engine SQLSTATE to its code at 409', () => {
    for (const [state, code] of Object.entries(COLLECTIVE_SQLSTATE_CODES)) {
      const mapped = collectiveDbError({ code: state, message: `${code}: refused` });
      expect(mapped?.status).toBe(409);
      expect(mapped?.code).toBe(code);
      expect(mapped?.body.code).toBe(code);
    }
  });

  it('names the host and collective when the route knows them', () => {
    const mapped = collectiveDbError({ code: 'RN001', message: 'x' }, { host: 'Light 3', collective: 'Northside' });
    expect(mapped?.body.error).toBe('This service is managed by Light 3 for Northside. Ask Light 3 to change it.');
    expect(collectiveDbError({ code: 'RN002' }, { collective: 'Northside' })?.body.error).toBe(
      'Take this service off the Northside page before deleting it.',
    );
  });

  it('falls back to plain words without names', () => {
    expect(collectiveDbError({ code: 'RN003' })?.body.error).toBe(
      'This add-on group is managed by the host for your collective. Ask the host to change it.',
    );
    expect(collectiveDbError({ code: 'P0001', message: 'COLLECTIVE_LEGACY_MODEL: nope' })?.body.error).toBe(
      'Your collective has not moved to shared services yet, so this is not available.',
    );
  });

  it('maps a listed P0001 prefix and nothing else', () => {
    expect(collectiveDbError({ code: 'P0001', message: 'COLLECTIVE_NOT_HOST: actor is not the host' })?.code).toBe(
      'COLLECTIVE_NOT_HOST',
    );
    expect(collectiveDbError({ code: 'P0001', message: 'COLLECTIVE_SOMETHING_NEW: x' })).toBeNull();
    expect(collectiveDbError({ code: 'P0001', message: 'plain failure' })).toBeNull();
    expect(collectiveDbError({ code: '23505', message: 'COLLECTIVE_NOT_HOST: spoofed' })).toBeNull();
    expect(collectiveDbError(null)).toBeNull();
  });

  it('never uses an em-dash', () => {
    const names = [{}, { host: 'H', collective: 'C' }];
    for (const n of names) {
      for (const state of Object.keys(COLLECTIVE_SQLSTATE_CODES)) {
        expect(collectiveDbError({ code: state }, n)?.body.error).not.toContain('—');
      }
      for (const code of COLLECTIVE_PREFIXED_CODES) {
        expect(collectiveDbError({ code: 'P0001', message: `${code}: x` }, n)?.body.error).not.toContain('—');
      }
    }
  });

  it('every mapped code is in API_ERROR_CODES', () => {
    const known = new Set<string>(API_ERROR_CODES);
    for (const code of [...Object.values(COLLECTIVE_SQLSTATE_CODES), ...COLLECTIVE_PREFIXED_CODES]) {
      expect(known.has(code), code).toBe(true);
    }
  });

  it('the migrations raise exactly the SQLSTATEs and prefixes mapped here', () => {
    const dir = join(process.cwd(), 'supabase', 'migrations');
    const states = new Set<string>();
    const prefixes = new Set<string>();
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql'))) {
      const sql = readFileSync(join(dir, f), 'utf8');
      for (const m of sql.matchAll(/ERRCODE\s*=\s*'(RN\d{3})'/g)) states.add(m[1]);
      for (const m of sql.matchAll(/RAISE EXCEPTION '(COLLECTIVE_[A-Z_]+):/g)) prefixes.add(m[1]);
    }
    const sqlstateCodes = new Set<string>(Object.values(COLLECTIVE_SQLSTATE_CODES));
    for (const s of states) expect(Object.keys(COLLECTIVE_SQLSTATE_CODES), s).toContain(s);
    for (const p of prefixes) {
      if (sqlstateCodes.has(p)) continue;
      expect(COLLECTIVE_PREFIXED_CODES as readonly string[], p).toContain(p);
    }
  });
});
