/**
 * Help centre verification report (Docs/help-assistant-plan.md, 6.2 step 7).
 *
 * Lists every help article with the date it was last checked against the live screens
 * (`verified` on the article), oldest first, so the stale ones are at the top. Articles with
 * no date come first of all.
 *
 * Usage: npm run help:verification-report
 */
import { HELP_CATEGORIES } from '../src/lib/help/navigation';

type Row = { id: string; verified: string; words: number };

const rows: Row[] = [];
for (const cat of HELP_CATEGORIES) {
  for (const art of cat.articles) {
    const body = art.markdownAppointments ?? art.content;
    rows.push({
      id: `${cat.slug}/${art.slug}`,
      verified: art.verified ?? '',
      words: body.split(/\s+/).filter(Boolean).length,
    });
  }
}
rows.sort((a, b) => (a.verified || '0000').localeCompare(b.verified || '0000') || a.id.localeCompare(b.id));

const width = Math.max(...rows.map((r) => r.id.length));
console.log(`${'Article'.padEnd(width)}  Verified    Words`);
for (const r of rows) {
  console.log(`${r.id.padEnd(width)}  ${(r.verified || 'never').padEnd(10)}  ${String(r.words).padStart(5)}`);
}
const never = rows.filter((r) => !r.verified).length;
console.log(`\n${rows.length} articles, ${never} never verified.`);
