import OpenAI from 'openai';
import type { AssistantArticle, AssistantCorpus } from '@/lib/help/assistant-corpus';
import { searchHelpArticlesWithFuse, createHelpSearchFuse } from '@/lib/help/search-index';
import { ASSISTANT_MAX_RETRIES, ASSISTANT_TIMEOUT_MS, assistantApiKey, describeOpenAiError } from './openai-stream';
import type { ChatTurn } from './prompt';

/**
 * Choosing which help articles an answer needs (Docs/help-assistant-plan.md, 2.2, Mode B).
 *
 * The whole help centre no longer fits in one prompt: it passed the plan's 120,000-token
 * trigger during the 2026-09 review, and it keeps growing. So a question is answered in two
 * calls. This is the first: the model sees only the table of contents, about 3,000 tokens for
 * every article, and names the few it wants. The answer call then carries just those.
 *
 * The shortlist from the help centre's own Fuse index goes in as a hint, not as the decision:
 * Fuse is good at "deposits" and bad at "a client wants to pay now", so it steers rather than
 * chooses. When the selector call fails for any reason, the Fuse shortlist IS the answer, so
 * a question still gets a real answer without a working selector.
 */

export const MAX_SELECTED_ARTICLES = 4;
export const SELECTOR_MAX_OUTPUT_TOKENS = 200;
const FUSE_HINTS = 6;

const SELECT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['article_ids'],
  properties: {
    article_ids: {
      type: 'array',
      description: `Up to ${MAX_SELECTED_ARTICLES} article ids, best first. Empty when the help centre does not cover the question.`,
      maxItems: MAX_SELECTED_ARTICLES,
      items: { type: 'string' },
    },
  },
} as const;

const SELECTOR_INSTRUCTIONS = `You route a question to the ResNeo help centre articles that answer it.

You see one line per article: its id, its title, what it covers, and its search words. Return the ids of the articles whose text an assistant would need to answer the question, best first, at most ${MAX_SELECTED_ARTICLES}.

- Return ids exactly as written, for example "getting-started/services".
- Prefer the article that owns the screen the question is about. Add a second when the answer plainly spans two screens, for example a setting in one place and its effect in another.
- The person's own venue details are given so you can route plan and billing questions to the right article.
- Return an empty list only when no article could contribute, for example a question about another product entirely.
- Do not answer the question. Return ids only.`;

/** Fuse over titles, descriptions and tags: cheap, and never worse than nothing. */
export function fuseShortlist(corpus: AssistantCorpus, question: string, limit = FUSE_HINTS): string[] {
  const docs = corpus.articles.map((a) => ({
    id: a.id,
    href: a.href,
    categorySlug: a.id.split('/')[0]!,
    categoryTitle: a.categoryTitle,
    articleSlug: a.id.split('/')[1]!,
    title: a.title,
    description: a.description,
    tagsText: a.tags.join(' '),
    content: a.markdown,
  }));
  return searchHelpArticlesWithFuse(createHelpSearchFuse(docs), question, limit).map((d) => d.id);
}

export interface SelectionResult {
  articles: AssistantArticle[];
  /** How the choice was made, for the log and the eval. */
  via: 'model' | 'fuse-fallback';
  approxTokens: number;
}

export interface SelectArticlesParams {
  corpus: AssistantCorpus;
  /** The conversation so far; the last turn is the question. */
  history: ChatTurn[];
  /** The rendered "This venue" block, so plan questions route correctly. */
  contextBlock: string;
  model: string;
  signal?: AbortSignal;
}

/** The subset of the corpus an answer will be written from. Never throws. */
export async function selectAssistantArticles(params: SelectArticlesParams): Promise<SelectionResult> {
  const { corpus, history, model } = params;
  const question = history[history.length - 1]?.content ?? '';
  const hints = fuseShortlist(corpus, question);

  const chosen = await askModelForIds(params, hints).catch((e) => {
    console.error('[assistant select] failed, falling back to search', { model, ...describeOpenAiError(e) });
    return null;
  });

  const ids = chosen ?? hints.slice(0, MAX_SELECTED_ARTICLES);
  const articles = ids.map((id) => corpus.byId.get(id)).filter((a): a is AssistantArticle => Boolean(a));
  return {
    articles,
    via: chosen ? 'model' : 'fuse-fallback',
    approxTokens: Math.round(articles.reduce((sum, a) => sum + a.markdown.length, 0) / 4),
  };
}

async function askModelForIds(params: SelectArticlesParams, hints: string[]): Promise<string[] | null> {
  const apiKey = assistantApiKey();
  if (!apiKey) return null;
  const { corpus, history, contextBlock, model, signal } = params;

  const openai = new OpenAI({ apiKey, timeout: ASSISTANT_TIMEOUT_MS, maxRetries: ASSISTANT_MAX_RETRIES });
  const hintLine = hints.length ? `\n\nA keyword search suggests these, in case they help: ${hints.join(', ')}` : '';

  const completion = await openai.chat.completions.create(
    {
      model,
      messages: [
        { role: 'system', content: `${SELECTOR_INSTRUCTIONS}\n\n# Articles\n${corpus.tableOfContents}${hintLine}` },
        { role: 'system', content: contextBlock },
        ...history.map((t) => ({ role: t.role, content: t.content })),
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'help_article_selection', strict: true, schema: SELECT_SCHEMA } },
      max_completion_tokens: SELECTOR_MAX_OUTPUT_TOKENS,
    },
    { signal },
  );

  const raw = completion.choices[0]?.message?.content;
  if (!raw) return null;
  const parsed = JSON.parse(raw) as { article_ids?: unknown };
  if (!Array.isArray(parsed.article_ids)) return null;
  // Keep only ids that exist, in the model's order, deduplicated.
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const value of parsed.article_ids) {
    if (typeof value !== 'string') continue;
    const id = value.trim();
    if (!corpus.byId.has(id) || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= MAX_SELECTED_ARTICLES) break;
  }
  return ids;
}
