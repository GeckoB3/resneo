import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * TERMS-04: no hand-written read of a calendar's own price or length outside the resolver.
 *
 * `custom_price_pence ?? price_pence` was written out by hand in a dozen places, and the copies
 * drifted (a length applied twice in the month loader, one calendar's values applied to a whole
 * venue on the combined page). Read them through `calendar-service-terms.ts`.
 *
 * This sweeps every non-test source file for a PROPERTY READ of the two columns
 * (`x.custom_price_pence`, `x?.custom_duration_minutes`, `x['custom_price_pence']`). Selecting
 * the columns, or writing them as object keys, is not a read and is not flagged.
 *
 * The allowlist names every file that may still read them, and why. Adding to it is a decision:
 * prefer calling `calendarPricePence` / `calendarDurationMinutes` / `resolveCalendarServiceTerms`.
 */
const ALLOWED: Record<string, string> = {
  'src/lib/booking/calendar-service-terms.ts': 'the resolver itself',
  // Loaders: copy the raw assignment row into the engine's link shape for the resolver to read.
  'src/lib/availability/appointment-catalog.ts': 'loader: assignment row to link row',
  'src/lib/availability/appointment-engine.ts': 'loader: assignment row to link row (price only; length is baked)',
  'src/lib/availability/appointment-month-availability.ts': 'loader: assignment row to link row (price only)',
  // Write routes and the editor: they store and edit the raw values, not resolve them.
  'src/app/api/venue/appointment-services/route.ts': 'write route: returns and diffs raw values',
  'src/app/api/venue/practitioner-service-overrides/route.ts': 'write route: stores raw values',
  'src/app/api/venue/practitioner-services/route.ts': 'write route: keeps raw values across a diff',
  'src/app/dashboard/appointment-services/AppointmentServicesView.tsx': 'editor: carries raw values into the form',
  'src/app/dashboard/appointment-services/StaffServiceOverrideModal.tsx': 'editor: writes raw values',
  'src/components/linked-accounts/collective/CollectiveCalendarsSection.tsx':
    "editor: shows a calendar's own stored values as chips and a comparison, already gated by the loader",
};

const READ = /[.?]\s*custom_(price_pence|duration_minutes)\b|\[\s*['"]custom_(price_pence|duration_minutes)['"]\s*\]/;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules' || name === '__tests__' || name === 'test-utils') continue;
      sourceFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

describe('calendar custom values are read only through the resolver (TERMS-04)', () => {
  const root = process.cwd();
  const files = sourceFiles(join(root, 'src')).map((f) => relative(root, f).split(sep).join('/'));

  it('finds no read outside the allowlist', () => {
    const offenders: string[] = [];
    for (const rel of files) {
      if (ALLOWED[rel]) continue;
      const lines = readFileSync(join(root, rel), 'utf8').split(/\r?\n/);
      lines.forEach((line, i) => {
        if (READ.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the allowlist honest: every entry still exists', () => {
    for (const rel of Object.keys(ALLOWED)) expect(files).toContain(rel);
  });
});
