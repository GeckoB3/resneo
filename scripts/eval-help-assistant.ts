/**
 * Ask ResNeo eval (Docs/help-assistant-plan.md, 5.3): scores the assistant's answers to the
 * golden questions against the CURRENT help corpus. NOT run in CI (needs OPENAI_API_KEY;
 * costs tokens), exactly like eval-import-ai.
 *
 * Usage:  npm run eval:help-assistant
 *         npm run eval:help-assistant -- --only 31,32      (a subset, by golden id)
 *         npm run eval:help-assistant -- --verbose         (print every answer)
 * Env:    OPENAI_API_KEY (required). The model comes from assistantModel(), so this tests
 *         whatever production would run.
 *
 * Exits non-zero below the pass threshold, so a prompt, model or corpus change can be gated
 * on it.
 */

import { config as loadEnv } from 'dotenv';

// The repo keeps its secrets in .env.local (the Next.js convention); dotenv reads .env.
loadEnv({ path: '.env.local' });
loadEnv();
import { buildAssistantCorpus } from '../src/lib/help/assistant-corpus';
import { buildAssistantMessages, buildContextBlock } from '../src/lib/assistant/prompt';
import { selectAssistantArticles } from '../src/lib/assistant/select-articles';
import { postprocessAnswer } from '../src/lib/assistant/postprocess';
import { completeAssistant } from '../src/lib/assistant/openai-stream';
import { assistantModel } from '../src/lib/assistant/model';
import { DEFAULT_GOLDEN_CONTEXT, HELP_GOLDENS, type HelpGolden } from '../src/lib/assistant/__fixtures__/help-goldens';

const PASS_THRESHOLD = 0.9;
const DEFAULT_MAX_WORDS = 220;
const CONCURRENCY = 4;

type Failure = string;

interface Scored {
  golden: HelpGolden;
  answer: string;
  citations: string[];
  failures: Failure[];
  ms: number;
  clarified: boolean;
  selected: string[];
  via: string;
  articleTokens: number;
}

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? '') : null;
}

/**
 * Prompt rule 5 lets the assistant ask ONE short clarifying question when a question could
 * mean two screens, and a clarifying question rightly carries no steps and no Read more line.
 * That is a good answer, not a miss, provided the selector routed to the right article.
 */
function isClarifyingQuestion(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.endsWith('?') && trimmed.split(/\s+/).length <= 45 && !trimmed.includes('\n\n');
}

function refusalLooksRight(text: string): boolean {
  const t = text.toLowerCase();
  return (
    t.includes('only help with resneo') ||
    t.includes('can only help') ||
    t.includes('cannot change') ||
    t.includes("can't change") ||
    t.includes('cannot make') ||
    t.includes("can't make") ||
    t.includes('cannot do that') ||
    t.includes("i can't do that") ||
    t.includes('do it yourself') ||
    t.includes('not able to')
  );
}

async function scoreOne(golden: HelpGolden): Promise<Scored> {
  const corpus = buildAssistantCorpus();
  const ctx = { ...DEFAULT_GOLDEN_CONTEXT, ...(golden.context ?? {}) };
  const history = [{ role: 'user' as const, content: golden.question }];
  const started = Date.now();
  // Exactly what the route does: choose the articles, then answer from only those.
  const selection = await selectAssistantArticles({ corpus, history, contextBlock: buildContextBlock(ctx), model: assistantModel() });
  const messages = buildAssistantMessages(ctx, history, selection.articles);
  const result = await completeAssistant({ model: assistantModel(), messages });
  const ms = Date.now() - started;
  const processed = postprocessAnswer(result.text, corpus);
  const failures: Failure[] = [];

  const clarified = isClarifyingQuestion(processed.text) && (golden.articles ?? []).some((a) => selection.articles.some((x) => x.id === a));

  if (golden.expect === 'cite' && !clarified) {
    const hit = (golden.articles ?? []).some((a) => processed.citations.includes(a));
    if (!hit) {
      failures.push(`cited ${processed.citations.length ? processed.citations.join(', ') : 'nothing'}, wanted one of ${(golden.articles ?? []).join(', ')}`);
    }
    if (!processed.answered) failures.push('fell back instead of answering');
  }

  if (golden.expect === 'fallback' && processed.answered) {
    failures.push('answered a question the articles do not cover');
  }

  if (golden.expect === 'refuse') {
    if (processed.citations.length > 0) failures.push(`cited ${processed.citations.join(', ')} on a question it should decline`);
    if (processed.answered && !refusalLooksRight(processed.text)) failures.push('does not read as a refusal');
  }

  for (const phrase of golden.mustSay ?? []) {
    if (!processed.text.toLowerCase().includes(phrase.toLowerCase())) failures.push(`never mentions "${phrase}"`);
  }

  for (const phrase of golden.mustNotSay ?? []) {
    if (processed.text.toLowerCase().includes(phrase.toLowerCase())) failures.push(`says "${phrase}", which claims an action it cannot take`);
  }

  // House style, on every row.
  if (processed.text.includes('—')) failures.push('contains an em-dash');
  if (processed.droppedLinks > 0) failures.push(`invented ${processed.droppedLinks} link(s) to pages that do not exist`);
  const cap = golden.maxWords ?? DEFAULT_MAX_WORDS;
  if (processed.words > cap) failures.push(`${processed.words} words, over the ${cap} cap`);

  // A wrong citation with the right article never offered is a routing failure, not a writing one.
  if (golden.expect === 'cite' && failures.length > 0 && !(golden.articles ?? []).some((a) => selection.articles.some((x) => x.id === a))) {
    failures.push('the selector did not offer any expected article');
  }

  return {
    golden,
    answer: processed.text,
    citations: processed.citations,
    failures,
    ms,
    clarified,
    selected: selection.articles.map((a) => a.id),
    via: selection.via,
    articleTokens: selection.approxTokens,
  };
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

async function main() {
  if (!process.env.OPENAI_API_KEY?.trim()) {
    console.error('OPENAI_API_KEY is not set. This eval calls the OpenAI API.');
    process.exit(1);
  }

  const only = arg('only');
  const verbose = process.argv.includes('--verbose');
  const ids = only ? new Set(only.split(',').map((s) => Number(s.trim()))) : null;
  const goldens = ids ? HELP_GOLDENS.filter((g) => ids.has(g.id)) : HELP_GOLDENS;

  const corpus = buildAssistantCorpus();
  console.log(`Model:  ${assistantModel()}`);
  console.log(
    `Corpus: ${corpus.articles.length} articles, version ${corpus.version}, ${corpus.approxTokens.toLocaleString()} tokens in full, ` +
      `${corpus.tocApproxTokens.toLocaleString()} as a contents list`,
  );
  console.log(`Asking ${goldens.length} golden questions...\n`);

  const scored = await mapWithConcurrency(goldens, CONCURRENCY, (g) =>
    scoreOne(g).catch((e) => ({
      golden: g,
      answer: '',
      citations: [],
      failures: [`call failed: ${e instanceof Error ? e.message : String(e)}`],
      ms: 0,
      clarified: false,
      selected: [],
      via: 'error',
      articleTokens: 0,
    })),
  );

  let passed = 0;
  for (const s of scored) {
    const ok = s.failures.length === 0;
    if (ok) passed += 1;
    const mark = ok ? (s.clarified ? 'ASK ' : 'PASS') : 'FAIL';
    console.log(`${mark}  ${String(s.golden.id).padStart(2)}  ${s.golden.question}`);
    if (!ok) for (const f of s.failures) console.log(`         ${f}`);
    if (!ok) console.log(`         selector (${s.via}) chose: ${s.selected.join(', ') || 'nothing'}`);
    if (verbose && s.answer) console.log(s.answer.split('\n').map((l) => `      | ${l}`).join('\n'));
  }

  const rate = scored.length ? passed / scored.length : 0;
  const slowest = scored.reduce((m, s) => Math.max(m, s.ms), 0);
  const avgTokens = scored.length ? Math.round(scored.reduce((t, x) => t + x.articleTokens, 0) / scored.length) : 0;
  const fallbacks = scored.filter((x) => x.via === 'fuse-fallback').length;
  console.log(`\n${passed}/${scored.length} passed (${(rate * 100).toFixed(0)}%). Slowest answer ${(slowest / 1000).toFixed(1)}s.`);
  const asked = scored.filter((x) => x.clarified).length;
  console.log(`Articles sent per answer: about ${avgTokens.toLocaleString()} tokens. Selector fell back to keyword search ${fallbacks} time(s).`);
  if (asked) console.log(`${asked} answer(s) asked a clarifying question instead, which the prompt allows (ASK).`);

  if (rate < PASS_THRESHOLD) {
    console.error(`\nBelow the ${(PASS_THRESHOLD * 100).toFixed(0)}% gate. Fix the articles first, then the prompt.`);
    process.exit(1);
  }
}

void main();
