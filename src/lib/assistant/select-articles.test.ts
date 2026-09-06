import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const create = vi.fn();
vi.mock('openai', () => ({ default: class { chat = { completions: { create } }; } }));

import { buildAssistantCorpus } from '@/lib/help/assistant-corpus';
import { MAX_SELECTED_ARTICLES, fuseShortlist, selectAssistantArticles } from './select-articles';

const corpus = buildAssistantCorpus();
const realIds = corpus.articles.map((a) => a.id);

function jsonReply(articleIds: unknown) {
  return { choices: [{ message: { content: JSON.stringify({ article_ids: articleIds }) } }] };
}

function params(question: string) {
  return {
    corpus,
    history: [{ role: 'user' as const, content: question }],
    contextBlock: '# This venue\n- Plan: Appointments Plus (status: active)',
    model: 'test-model',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('OPENAI_API_KEY', 'sk-test');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/** Docs/help-assistant-plan.md, 2.2 (Mode B): choosing the articles an answer is written from. */
describe('selectAssistantArticles', () => {
  it('returns the articles the model named, in its order', async () => {
    const wanted = [realIds[3]!, realIds[1]!];
    create.mockResolvedValueOnce(jsonReply(wanted));

    const result = await selectAssistantArticles(params('How do I set my hours?'));
    expect(result.articles.map((a) => a.id)).toEqual(wanted);
    expect(result.via).toBe('model');
    expect(result.approxTokens).toBeGreaterThan(0);
  });

  it('shows the selector the contents list, the venue and the question, and nothing else', async () => {
    create.mockResolvedValueOnce(jsonReply([realIds[0]!]));
    await selectAssistantArticles(params('How do I connect Stripe?'));

    const body = create.mock.calls[0]![0] as { messages: Array<{ content: string }>; response_format: unknown };
    expect(body.messages[0]!.content).toContain('# Articles');
    expect(body.messages[0]!.content).toContain(corpus.tableOfContents);
    // The contents list, not the corpus: sending every article is what Mode B avoids.
    expect(body.messages[0]!.content).not.toContain(corpus.articles[0]!.markdown);
    expect(body.messages[1]!.content).toContain('# This venue');
    expect(body.messages[2]).toEqual({ role: 'user', content: 'How do I connect Stripe?' });
    expect(body.response_format).toMatchObject({ type: 'json_schema' });
  });

  it('drops ids that do not exist, deduplicates, and caps the count', async () => {
    create.mockResolvedValueOnce(jsonReply([realIds[2]!, 'made-up/article', realIds[2]!, 42, ...realIds.slice(5, 12)]));
    const result = await selectAssistantArticles(params('anything'));
    expect(result.articles.map((a) => a.id)[0]).toBe(realIds[2]!);
    expect(result.articles).toHaveLength(MAX_SELECTED_ARTICLES);
    expect(new Set(result.articles.map((a) => a.id)).size).toBe(result.articles.length);
    expect(result.articles.every((a) => corpus.byId.has(a.id))).toBe(true);
  });

  it('returns nothing when the model says no article fits, so the assistant falls back', async () => {
    create.mockResolvedValueOnce(jsonReply([]));
    const result = await selectAssistantArticles(params('How do I export payroll to Xero?'));
    expect(result.articles).toEqual([]);
    expect(result.via).toBe('model');
  });

  it('falls back to keyword search when the selector call fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    create.mockRejectedValueOnce(new Error('upstream down'));

    const result = await selectAssistantArticles(params('deposits'));
    expect(result.via).toBe('fuse-fallback');
    expect(result.articles.length).toBeGreaterThan(0);
    expect(result.articles.length).toBeLessThanOrEqual(MAX_SELECTED_ARTICLES);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('falls back to keyword search when there is no API key at all', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    const result = await selectAssistantArticles(params('deposits'));
    expect(result.via).toBe('fuse-fallback');
    expect(create).not.toHaveBeenCalled();
  });
});

describe('fuseShortlist', () => {
  it('finds the obvious article for an obvious word', () => {
    expect(fuseShortlist(corpus, 'deposits').some((id) => id.includes('deposit'))).toBe(true);
    expect(fuseShortlist(corpus, 'compliance').some((id) => id.includes('compliance'))).toBe(true);
  });

  it('returns real ids, and never more than asked for', () => {
    const ids = fuseShortlist(corpus, 'how do I add a service', 3);
    expect(ids.length).toBeLessThanOrEqual(3);
    expect(ids.every((id) => corpus.byId.has(id))).toBe(true);
  });
});
