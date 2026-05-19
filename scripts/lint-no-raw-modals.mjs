#!/usr/bin/env node
/**
 * Flags hand-rolled modal shells: role="dialog" with fixed inset-0 backdrop
 * outside src/components/ui/primitives/.
 *
 * Usage: node scripts/lint-no-raw-modals.mjs
 * Exit 1 if violations found (for CI).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const SRC = join(ROOT, 'src');
const ALLOWED_PREFIX = join(SRC, 'components', 'ui', 'primitives');

const EXT = new Set(['.tsx', '.ts', '.jsx', '.js']);

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === 'node_modules' || name === '.next') continue;
      walk(p, files);
    } else if (EXT.has(name.slice(name.lastIndexOf('.')))) {
      files.push(p);
    }
  }
  return files;
}

function isAllowed(filePath) {
  const norm = filePath.replace(/\\/g, '/');
  return norm.includes('/components/ui/primitives/');
}

const ALLOWLIST_PATH = join(import.meta.dirname, 'lint-no-raw-modals-allowlist.txt');
let allowlist = new Set();
try {
  allowlist = new Set(
    readFileSync(ALLOWLIST_PATH, 'utf8')
      .split('\n')
      .map((l) => l.trim().replace(/\\/g, '/'))
      .filter(Boolean),
  );
} catch {
  console.warn('lint-no-raw-modals: no allowlist file; all violations fail. Run: node scripts/generate-modal-allowlist.mjs');
}

const violations = [];

for (const file of walk(SRC)) {
  if (isAllowed(file)) continue;
  const content = readFileSync(file, 'utf8');
  const hasDialogRole = /role\s*=\s*["']dialog["']/.test(content);
  const hasFixedInset = /fixed\s+inset-0|fixed\s+inset-x-0/.test(content);
  if (hasDialogRole && hasFixedInset) {
    violations.push(relative(ROOT, file).replace(/\\/g, '/'));
  }
}

const newViolations = violations.filter((v) => !allowlist.has(v));
const removedFromCode = [...allowlist].filter((a) => !violations.includes(a));

if (newViolations.length > 0) {
  console.error('lint-no-raw-modals: NEW hand-rolled modal shells (not in allowlist).\n');
  console.error('Use Dialog or Sheet from @/components/ui/primitives instead.\n');
  for (const v of newViolations.sort()) {
    console.error(`  - ${v}`);
  }
  console.error(`\n${newViolations.length} new file(s). See Docs/DESIGN_SYSTEM.md`);
  process.exit(1);
}

if (removedFromCode.length > 0) {
  console.warn(
    'lint-no-raw-modals: allowlist has migrated paths (safe to remove from allowlist):\n',
    removedFromCode.map((p) => `  - ${p}`).join('\n'),
  );
}

console.log('lint-no-raw-modals: OK (no new violations outside allowlist)');
