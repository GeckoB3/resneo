import { describe, expect, it } from 'vitest';
import { HELP_CATEGORIES, helpArticleHref } from './navigation';
import { HELP_VIDEOS } from './help-videos';
import { assistantArticleMarkdown, buildAssistantCorpus, buildAssistantCorpusFrom } from './assistant-corpus';
import type { HelpCategory } from './types';

/** Docs/help-assistant-plan.md, 5.1: the corpus builder invariants. */
describe('buildAssistantCorpus', () => {
  const corpus = buildAssistantCorpus();

  it('carries every article of every category, in order', () => {
    const expected = HELP_CATEGORIES.flatMap((c) => c.articles.map((a) => `${c.slug}/${a.slug}`));
    expect(corpus.articles.map((a) => a.id)).toEqual(expected);
    expect(corpus.articles.length).toBeGreaterThanOrEqual(53);
  });

  it('gives every block a Path equal to the help centre href', () => {
    for (const a of corpus.articles) {
      const [cat, slug] = a.id.split('/');
      expect(a.href).toBe(helpArticleHref(cat!, slug!));
      expect(corpus.text).toContain(`## ${a.title}\nPath: ${a.href}\n`);
    }
    expect(corpus.hrefs.size).toBe(corpus.articles.length);
  });

  it('leaves no figure or video marker in the text', () => {
    expect(corpus.text).not.toMatch(/^:::/m);
    expect(corpus.text).not.toContain(':::help-figure');
    expect(corpus.text).not.toContain(':::help-video');
  });

  it('turns every video marker into a youtu.be link the model may cite', () => {
    const referenced = HELP_CATEGORIES.flatMap((c) =>
      c.articles.flatMap((a) => [...(a.markdownAppointments ?? a.content).matchAll(/^[ \t]*:::help-video[ \t]+([a-z0-9-]+)/gm)].map((m) => m[1]!)),
    );
    expect(referenced.length).toBeGreaterThan(0);
    for (const id of referenced) {
      const def = HELP_VIDEOS[id as keyof typeof HELP_VIDEOS];
      expect(def).toBeDefined();
      expect(corpus.text).toContain(`Video: [${def.title}](https://youtu.be/${def.youtubeId})`);
      expect(corpus.videoIds.has(def.youtubeId)).toBe(true);
    }
  });

  it('never reads the restaurant body (decision D1)', () => {
    const withRestaurant = HELP_CATEGORIES.flatMap((c) => c.articles).filter((a) => a.markdownRestaurant);
    expect(withRestaurant.length).toBeGreaterThan(0);
    for (const a of withRestaurant) {
      const restaurantOnly = a.markdownRestaurant!.trim().slice(0, 200);
      const chosen = assistantArticleMarkdown(a);
      expect(chosen).toBe(assistantArticleMarkdown({ ...a, markdownRestaurant: undefined }));
      if (restaurantOnly && !(a.markdownAppointments ?? a.content).includes(restaurantOnly)) {
        expect(chosen).not.toContain(restaurantOnly);
      }
    }
  });

  it('changes its version when any body changes, and not otherwise', () => {
    const again = buildAssistantCorpusFrom(HELP_CATEGORIES);
    expect(again.version).toBe(corpus.version);
    expect(again.text).toBe(corpus.text);

    const edited: HelpCategory[] = HELP_CATEGORIES.map((c, i) =>
      i === 0 ? { ...c, articles: c.articles.map((a, j) => (j === 0 ? { ...a, content: `${a.content}\n\nOne more line.` } : a)) } : c,
    );
    expect(buildAssistantCorpusFrom(edited).version).not.toBe(corpus.version);
  });

  it('estimates tokens from characters', () => {
    expect(corpus.approxTokens).toBe(Math.round(corpus.text.length / 4));
    expect(corpus.approxTokens).toBeGreaterThan(30_000);
  });

  /**
   * The corpus outgrew a single prompt during the 2026-09 help review, which is exactly the
   * trigger Docs/help-assistant-plan.md 2.2 describes. What must stay small is the CONTENTS
   * list the selector reads, not the corpus: that is what keeps a question affordable however
   * many articles the help centre gains.
   */
  it('keeps a contents list small enough to send whole, however large the corpus grows', () => {
    expect(corpus.tocApproxTokens).toBe(Math.round(corpus.tableOfContents.length / 4));
    expect(corpus.tocApproxTokens).toBeLessThan(15_000);
    expect(corpus.tocApproxTokens).toBeLessThan(corpus.approxTokens / 4);
    for (const a of corpus.articles) {
      expect(corpus.tableOfContents).toContain(`- ${a.id} | ${a.title}: `);
    }
  });

  it('indexes every article by the id the selector returns', () => {
    expect(corpus.byId.size).toBe(corpus.articles.length);
    for (const a of corpus.articles) expect(corpus.byId.get(a.id)).toBe(a);
  });

  it('keeps any four articles well inside one prompt', () => {
    const largest = [...corpus.articles].sort((x, y) => y.markdown.length - x.markdown.length).slice(0, 4);
    const worstCase = Math.round(largest.reduce((sum, a) => sum + a.markdown.length, 0) / 4);
    expect(worstCase).toBeLessThan(40_000);
  });

  it('is memoised per process', () => {
    expect(buildAssistantCorpus()).toBe(corpus);
  });
});
