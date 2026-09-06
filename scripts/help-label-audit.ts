/**
 * Help centre label audit (Docs/help-assistant-plan.md, 6.2 step 0).
 *
 * For every help article, lists the bold labels (`**Like this**`) and backticked dashboard
 * paths (`/dashboard/...`) that appear nowhere in `src/` outside the help centre itself. A
 * zero-hit label is a renamed or removed control, or a label the UI composes at runtime;
 * either way it is the first thing to check when walking that article against the screen.
 * Expect some false positives; the value is the true positives.
 *
 * Usage: npm run help:label-audit            (human-readable)
 *        npm run help:label-audit -- --json  (machine-readable, per article)
 */
import * as fs from 'fs';
import * as path from 'path';
import { HELP_CATEGORIES } from '../src/lib/help/navigation';

const SRC = path.resolve('src');
const EXCLUDED_DIRS = [path.join(SRC, 'lib', 'help'), path.join(SRC, 'components', 'help')];

function walk(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || EXCLUDED_DIRS.includes(full)) continue;
      walk(full, out);
    } else if (/\.(tsx?|jsx?|mdx?)$/.test(entry.name) && !/\.test\.[tj]sx?$/.test(entry.name)) {
      out.push(full);
    }
  }
}

function normalise(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

const files: string[] = [];
walk(SRC, files);
const haystack = normalise(files.map((f) => fs.readFileSync(f, 'utf8')).join('\n'));

const GENERIC = new Set(['on', 'off', 'yes', 'no', 'save', 'cancel', 'delete', 'edit', 'add', 'remove', 'close', 'back', 'next', 'done']);

function labelsOf(markdown: string): { bold: string[]; paths: string[] } {
  const bold = new Set<string>();
  const paths = new Set<string>();
  for (const m of markdown.matchAll(/\*\*([^*\n]{2,80}?)\*\*/g)) {
    const raw = normalise(m[1]!).replace(/[.:,;!?]+$/g, '').trim();
    if (raw.length < 3 || GENERIC.has(raw.toLowerCase())) continue;
    if (/^[\d£$%.,\s]+$/.test(raw)) continue;
    bold.add(raw);
  }
  for (const m of markdown.matchAll(/`(\/(?:dashboard|help|book|account|manage|confirm|pay|embed)[^`\s]*)`/g)) {
    paths.add(m[1]!);
  }
  return { bold: [...bold], paths: [...paths] };
}

function pathExists(p: string): boolean {
  const pathname = p.split('?')[0]!.split('#')[0]!;
  if (haystack.includes(pathname)) return true;
  const dir = path.join(SRC, 'app', ...pathname.split('/').filter(Boolean));
  return fs.existsSync(dir);
}

const json = process.argv.includes('--json');
const report: Record<string, { labels: string[]; paths: string[] }> = {};
let articles = 0;
let flagged = 0;

for (const cat of HELP_CATEGORIES) {
  for (const art of cat.articles) {
    articles += 1;
    const body = art.markdownAppointments ?? art.content;
    const { bold, paths } = labelsOf(body);
    const missingLabels = bold.filter((l) => !haystack.includes(l));
    const missingPaths = paths.filter((p) => !pathExists(p));
    if (missingLabels.length || missingPaths.length) {
      flagged += 1;
      report[`${cat.slug}/${art.slug}`] = { labels: missingLabels, paths: missingPaths };
    }
  }
}

if (json) {
  process.stdout.write(JSON.stringify(report, null, 2));
} else {
  for (const [id, r] of Object.entries(report)) {
    console.log(`\n${id}`);
    for (const l of r.labels) console.log(`  label not found in src: **${l}**`);
    for (const p of r.paths) console.log(`  path not found: ${p}`);
  }
  console.log(`\n${articles} articles scanned, ${flagged} with at least one zero-hit label or path.`);
}
