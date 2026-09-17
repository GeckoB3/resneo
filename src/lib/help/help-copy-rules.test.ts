/**
 * HLP-01: the help centre's own copy rule. No article and no figure may carry an em-dash
 * (U+2014), because every string a user reads is written without one (CLAUDE.md). The booking and
 * assistant copy tests do not reach these files, and the collective work rewrites many of them.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const HELP_DIRS = ['src/lib/help/articles', 'src/components/help'];
const EM_DASH = '—';

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

describe('help centre copy', () => {
  const files = HELP_DIRS.flatMap((d) => filesUnder(join(ROOT, d)));

  it('covers the articles and the figures', () => {
    expect(files.some((f) => f.includes(join('help', 'articles')))).toBe(true);
    expect(files.some((f) => f.includes(join('components', 'help')))).toBe(true);
  });

  it('never uses an em-dash', () => {
    const offenders = files.flatMap((file) =>
      readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => line.includes(EM_DASH))
        .map(({ index }) => `${relative(ROOT, file)}:${index + 1}`),
    );
    expect(offenders).toEqual([]);
  });
});
