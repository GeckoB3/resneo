import { FALLBACK_SENTENCE } from './prompt';

/**
 * What happens to an answer after the stream ends (Docs/help-assistant-plan.md, 2.5).
 * Links to help pages that do not exist are turned back into plain text, so an invented
 * page can never reach the screen or the log; the citations and the answered bit are read
 * off the surviving links and the fallback sentence. Nothing else is rewritten.
 */

export interface AnswerCorpusView {
  hrefs: Set<string>;
  videoIds: Set<string>;
}

export interface PostprocessResult {
  text: string;
  /** `category/slug` ids of the help articles the answer links. */
  citations: string[];
  /** False when the reply starts with the fallback sentence. */
  answered: boolean;
  droppedLinks: number;
  words: number;
}

const MARKDOWN_LINK = /\[([^\]\n]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const YOUTUBE = /^https?:\/\/(?:www\.)?(?:youtu\.be\/|youtube\.com\/watch\?v=)([A-Za-z0-9_-]{6,})/;

function normaliseApostrophes(s: string): string {
  return s.replace(/[‘’]/g, "'");
}

export function startsWithFallback(text: string): boolean {
  return normaliseApostrophes(text).trimStart().startsWith(normaliseApostrophes(FALLBACK_SENTENCE));
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Keeps a link only when its target is a real help page, a listed video, or a dashboard path. */
export function isAllowedHref(href: string, corpus: AnswerCorpusView): boolean {
  const target = href.trim();
  if (target.startsWith('/help/')) {
    const pathname = target.split('?')[0]!.split('#')[0]!.replace(/\/+$/, '');
    return corpus.hrefs.has(pathname);
  }
  if (target.startsWith('/dashboard')) return true;
  const yt = target.match(YOUTUBE);
  if (yt) return corpus.videoIds.has(yt[1]!);
  return false;
}

export function postprocessAnswer(raw: string, corpus: AnswerCorpusView): PostprocessResult {
  const citations = new Set<string>();
  let droppedLinks = 0;
  const text = raw.replace(MARKDOWN_LINK, (_m, label: string, href: string) => {
    if (!isAllowedHref(href, corpus)) {
      droppedLinks += 1;
      return label;
    }
    if (href.startsWith('/help/')) {
      citations.add(href.split('?')[0]!.split('#')[0]!.replace(/\/+$/, '').slice('/help/'.length));
    }
    return `[${label}](${href})`;
  });
  return {
    text,
    citations: [...citations],
    answered: !startsWithFallback(text),
    droppedLinks,
    words: countWords(text),
  };
}
