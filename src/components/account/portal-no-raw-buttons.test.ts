import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * P0-7 acceptance check (1), as a test rather than a one-off grep.
 *
 * The migration is only worth doing if it stays done. Without this, the next
 * component added to the portal reintroduces a hand-rolled button with its own
 * focus ring, its own disabled styling and no in-flight guard, and nothing
 * says so. That is how the 24 got there.
 *
 * Deliberately NOT `npm run lint:modals`, which the plan calls out: that rule
 * looks for hand-rolled modal shells, passes today, and would have passed
 * after zero work on this task. Citing it as evidence here would have been
 * citing something that proves nothing about buttons.
 */

const PORTAL_DIRS = [
  path.join(process.cwd(), 'src', 'app', 'account'),
  path.join(process.cwd(), 'src', 'components', 'account'),
];

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsxFiles(full));
    else if (entry.name.endsWith('.tsx') && !entry.name.includes('.test.')) out.push(full);
  }
  return out;
}

const rel = (f: string) => path.relative(process.cwd(), f).replace(/\\/g, '/');

describe('P0-7: the portal uses the Button primitive', () => {
  it('no hand-rolled <button> survives under the two portal directories', () => {
    const offenders: string[] = [];
    for (const dir of PORTAL_DIRS) {
      for (const file of tsxFiles(dir)) {
        const src = fs.readFileSync(file, 'utf8');
        const matches = src.match(/<button[\s>]/g);
        if (matches) offenders.push(`${rel(file)} (${matches.length})`);
      }
    }
    expect(
      offenders,
      'Use Button or IconButton from @/components/ui/primitives. A hand-rolled button ' +
        'brings its own focus ring, its own disabled styling, and no in-flight guard.',
    ).toEqual([]);
  });

  it('the sweep is not vacuous: it reads the files it claims to check', () => {
    // Without this, deleting the portal would make the test above pass.
    const files = PORTAL_DIRS.flatMap(tsxFiles);
    expect(files.length).toBeGreaterThan(15);
    expect(files.some((f) => f.includes('AccountCoursesSection'))).toBe(true);
    // And the primitive really is in use, rather than every button removed.
    const usingButton = files.filter((f) =>
      /from '@\/components\/ui\/primitives'/.test(fs.readFileSync(f, 'utf8')),
    );
    expect(usingButton.length).toBeGreaterThanOrEqual(9);
  });
});
