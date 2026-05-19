import { readFileSync, writeFileSync } from 'node:fs';

const bad = 'motion';
const good = 'div';

for (const f of process.argv.slice(2)) {
  let c = readFileSync(f, 'utf8');
  c = c.replaceAll(`</${bad}>`, `</${good}>`);
  c = c.replaceAll(`<${bad} `, `<${good} `);
  c = c.replaceAll(`<${bad}>`, `<${good}>`);
  writeFileSync(f, c);
  console.log('fixed', f);
}
