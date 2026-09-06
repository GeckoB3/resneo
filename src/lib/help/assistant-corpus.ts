import { createHash } from 'crypto';
import { HELP_CATEGORIES, helpArticleHref } from './navigation';
import { HELP_VIDEOS, type HelpVideoDef } from './help-videos';
import { stripHelpFigureMarkers } from './split-markdown-figures';
import type { HelpArticle, HelpCategory } from './types';

/**
 * The help centre as the Ask ResNeo assistant reads it (Docs/help-assistant-plan.md, 2.1).
 *
 * One corpus for every venue: the restaurant plan is not offered (decision D1), so each
 * article contributes its appointments body (`markdownAppointments ?? content`) and
 * `markdownRestaurant` is never read. Video markers become links the model may cite;
 * figure markers are dropped (the SVGs carry nothing the text does not). The corpus is built
 * from the same modules that render /help, so it is exactly as current as the help centre.
 */

export interface AssistantArticle {
  /** `${category.slug}/${article.slug}` */
  id: string;
  /** `/help/<category>/<slug>`, the only paths the model may link. */
  href: string;
  title: string;
  categoryTitle: string;
  description: string;
  /** Search words from the article, so the selector can match a question to it. */
  tags: string[];
  /** The body as sent to the model. */
  markdown: string;
}

export interface AssistantCorpus {
  /** First 12 hex characters of sha256(text); changes whenever any article changes. */
  version: string;
  articles: AssistantArticle[];
  byId: Map<string, AssistantArticle>;
  hrefs: Set<string>;
  videoIds: Set<string>;
  /** Every article's full text. Too large for one prompt; see `tableOfContents`. */
  text: string;
  approxTokens: number;
  /**
   * One line per article: id, title, summary and tags. About 3,000 tokens for the whole help
   * centre, so the selector call can see everything at once and name the few articles the
   * answer needs (Docs/help-assistant-plan.md, 2.2 Mode B).
   */
  tableOfContents: string;
  tocApproxTokens: number;
}

const VIDEO_MARKER = /^[ \t]*:::help-video[ \t]+([a-z0-9-]+)[ \t]*$/gm;

export function assistantVideoLine(id: string): string | null {
  const def = (HELP_VIDEOS as Record<string, HelpVideoDef | undefined>)[id];
  return def ? `Video: [${def.title}](https://youtu.be/${def.youtubeId})` : null;
}

/** The body the assistant sees: appointments variant, videos as links, figures dropped. */
export function assistantArticleMarkdown(article: HelpArticle): string {
  const body = article.markdownAppointments ?? article.content;
  const withVideos = body.replace(VIDEO_MARKER, (_m, id: string) => assistantVideoLine(id) ?? '');
  return stripHelpFigureMarkers(withVideos)
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** One selector-facing line: the id it must return, plus what the article is about. */
export function assistantTocLine(a: AssistantArticle): string {
  const tags = a.tags.length ? ` [${a.tags.join(', ')}]` : '';
  return `- ${a.id} | ${a.title}: ${a.description}${tags}`;
}

export function assistantArticleBlock(a: AssistantArticle): string {
  return [`## ${a.title}`, `Path: ${a.href}`, `Category: ${a.categoryTitle}`, `Summary: ${a.description}`, '', a.markdown, '', '---'].join(
    '\n',
  );
}

export function buildAssistantCorpusFrom(categories: HelpCategory[]): AssistantCorpus {
  const articles: AssistantArticle[] = [];
  for (const cat of categories) {
    for (const art of cat.articles) {
      articles.push({
        id: `${cat.slug}/${art.slug}`,
        href: helpArticleHref(cat.slug, art.slug),
        title: art.title,
        categoryTitle: cat.title,
        description: art.description,
        tags: art.tags ?? [],
        markdown: assistantArticleMarkdown(art),
      });
    }
  }
  const text = articles.map(assistantArticleBlock).join('\n\n');
  const tableOfContents = articles.map(assistantTocLine).join('\n');
  const version = createHash('sha256').update(text).digest('hex').slice(0, 12);
  return {
    version,
    articles,
    byId: new Map(articles.map((a) => [a.id, a])),
    hrefs: new Set(articles.map((a) => a.href)),
    videoIds: new Set(Object.values(HELP_VIDEOS as Record<string, HelpVideoDef>).map((v) => v.youtubeId)),
    text,
    approxTokens: Math.round(text.length / 4),
    tableOfContents,
    tocApproxTokens: Math.round(tableOfContents.length / 4),
  };
}

let memo: AssistantCorpus | null = null;

/** Memoised once per process; the builder is pure, so tests may call `buildAssistantCorpusFrom` directly. */
export function buildAssistantCorpus(): AssistantCorpus {
  if (!memo) memo = buildAssistantCorpusFrom(HELP_CATEGORIES);
  return memo;
}
