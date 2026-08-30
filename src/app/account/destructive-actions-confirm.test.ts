/**
 * P2-6 acceptance, the structural half (closes G13).
 *
 * The plan's own acceptance is a grep: `window.confirm` must not appear under
 * `src/app/account` or `src/components/account`. It returned two hits when
 * P2-6 was written, in `AccountCoursesSection` and `AccountRecurringSection`.
 *
 * Asserted here rather than left as a command someone might run, because the
 * failure it guards is the next destructive control being added the quick way.
 * A browser confirm box is one sentence in a system dialog, it cannot say what
 * a cancellation costs or when it takes effect, and it is indistinguishable
 * from the ones websites use to nag.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const PORTAL_DIRS = [
  path.join(ROOT, 'src/app/account'),
  path.join(ROOT, 'src/components/account'),
];

function sourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

const rel = (f: string) => path.relative(ROOT, f).replace(/\\/g, '/');

describe('P2-6: destructive portal actions confirm through the design system', () => {
  it('reads a real portal, so the assertions below cannot pass on nothing', () => {
    const files = PORTAL_DIRS.flatMap(sourceFiles);
    expect(files.length).toBeGreaterThan(20);
    expect(files.map(rel)).toContain('src/components/account/AccountCoursesSection.tsx');
  });

  it('no portal file uses a browser confirm box', () => {
    const offenders = PORTAL_DIRS.flatMap(sourceFiles).filter((f) =>
      /\bwindow\.confirm\s*\(|(?<![\w.])confirm\s*\(/.test(fs.readFileSync(f, 'utf8')),
    );
    expect(
      offenders.map(rel),
      'use ConfirmDialog from @/components/ui/primitives, which can state the consequence',
    ).toEqual([]);
  });

  it('every section that cancels or deletes imports ConfirmDialog', () => {
    /*
      A grep for the absence of the wrong thing passes just as happily on a
      control with NO confirmation, which is what the membership cancel was.
      This is the other half: the files that perform these actions must have
      the dialog in them.
    */
    const MUST_CONFIRM = [
      'src/components/account/AccountMembershipsSection.tsx',
      'src/components/account/AccountCoursesSection.tsx',
      'src/components/account/AccountRecurringSection.tsx',
      'src/components/account/CancelCourseButton.tsx',
      'src/app/account/profile/ProfileClient.tsx',
    ];
    for (const file of MUST_CONFIRM) {
      const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
      expect(src, `${file} performs a destructive action without ConfirmDialog`).toContain(
        'ConfirmDialog',
      );
    }
  });

  it('account deletion keeps its typed confirmation, which is stronger', () => {
    /*
      NOT converted, deliberately. Requesting deletion is guarded by typing
      DELETE MY ACCOUNT, which is a higher bar than a dialog, and it is
      reversible from the same panel. Swapping it for a two-button dialog to
      satisfy a rule about dialogs would make the most consequential action in
      the portal easier to trigger than the least.
    */
    const src = fs.readFileSync(
      path.join(ROOT, 'src/components/account/AccountSecuritySection.tsx'),
      'utf8',
    );
    expect(src).toContain('DELETE MY ACCOUNT');
    // And it still states the consequence, which is the rule behind the rule.
    expect(src).toMatch(/grace period/i);
    expect(src).toMatch(/anonymises/i);
  });
});
