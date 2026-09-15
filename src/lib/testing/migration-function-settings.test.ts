import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Hosted Supabase refuses a function-level `SET <custom>.<name> = ...` clause to the migration role:
 * `permission denied to set parameter "resneo.collective_engine"` (42501). Attaching a custom
 * (placeholder) setting to a function needs a superuser, and the migration role is not one. It
 * aborted the push of 20270215130000 on staging on 2026-09-15, while a local Postgres running as
 * superuser (and PGlite) accepted it.
 *
 * Built-in settings (search_path, lock_timeout, statement_timeout, ...) are fine. A custom setting
 * is set at run time instead, with set_config(..., true), as the collective engine does
 * (collective_engine_enter / collective_engine_leave).
 */
const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations');

describe('migrations: no function-level custom settings', () => {
  it('never attaches a dotted (custom) setting to a function definition', () => {
    const offenders: string[] = [];
    for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
      const lines = readFileSync(join(MIGRATIONS, file), 'utf8').split(/\r?\n/);
      lines.forEach((line, i) => {
        // A clause line inside a CREATE FUNCTION header: `SET x.y = ...` or `SET x.y TO ...`.
        if (/^\s*SET\s+[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*\s*(=|TO\b)/i.test(line)) {
          offenders.push(`${file}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
