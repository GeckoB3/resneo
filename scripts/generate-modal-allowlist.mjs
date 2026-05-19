#!/usr/bin/env node
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const SRC = join(ROOT, 'src');
const OUT = join(import.meta.dirname, 'lint-no-raw-modals-allowlist.txt');
const EXT = new Set(['.tsx', '.ts']);

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === 'node_modules' || name === '.next') continue;
      walk(p, files);
    } else if (EXT.has(name.slice(name.lastIndexOf('.')))) files.push(p);
  }
  return files;
}

const violations = [];
for (const file of walk(SRC)) {
  if (file.replace(/\\/g, '/').includes('/components/ui/primitives/')) continue;
  const content = readFileSync(file, 'utf8');
  if (/role\s*=\s*["']dialog["']/.test(content) && /fixed\s+inset-0|fixed\s+inset-x-0/.test(content)) {
    violations.push(relative(ROOT, file).replace(/\\/g, '/'));
  }
}
writeFileSync(OUT, `${violations.sort().join('\n')}\n`);
console.log(`Wrote ${violations.length} paths to ${OUT}`);
