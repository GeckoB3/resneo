/**
 * D41 (LIFE-09, LIFE-14): a collective sits on top of account links and never changes them. Joining,
 * leaving, removal, the end of a collective, the hosting moves, suspensions and the reconcile all
 * run from the files below, and none of them may address the account link tables at all. Links are
 * read through `queries.ts` and changed only by the Linked accounts routes.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const collectFiles = (dir: string): string[] =>
  readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return collectFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });

const LIFECYCLE = [
  ...collectFiles('src/lib/linked-accounts/replicas'),
  ...collectFiles('src/app/api/venue/collectives'),
  ...collectFiles('src/app/api/cron/collective-replicate'),
  ...collectFiles('src/app/api/cron/collective-verify'),
  'src/lib/linked-accounts/collectives.ts',
  'src/lib/linked-accounts/collective-venue-locks.ts',
];

describe('collective lifecycle code and account links (D41)', () => {
  it('covers the lifecycle modules', () => {
    expect(LIFECYCLE.some((f) => f.endsWith('release-actions.ts'))).toBe(true);
    expect(LIFECYCLE.some((f) => f.split(sep).join('/').endsWith('members/route.ts'))).toBe(true);
    expect(LIFECYCLE.length).toBeGreaterThan(30);
  });

  it.each(LIFECYCLE)('%s never addresses an account link table', (file) => {
    const source = readFileSync(join(root, file), 'utf8');
    expect(source).not.toMatch(/from\(\s*['"]account_link(s|_audit_log)['"]\s*\)/);
  });
});
