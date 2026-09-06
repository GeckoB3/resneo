'use client';

import { useMemo, type MouseEvent } from 'react';
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

/**
 * Renders an Ask ResNeo answer. The same `marked` + `sanitize-html` pair the help centre uses
 * (HelpArticleContent), with a tighter allowlist and an href allowlist: links may point only
 * at help pages, dashboard pages or YouTube videos; anything else is rendered as plain text.
 * The route already strips links to pages that do not exist; this is the second gate.
 */

marked.setOptions({ gfm: true, breaks: false });

export function isRenderableHref(href: string | undefined): boolean {
  if (!href) return false;
  if (href.startsWith('/help/') || href.startsWith('/dashboard')) return true;
  return /^https:\/\/(www\.)?(youtu\.be|youtube\.com)\//.test(href);
}

export function renderAssistantMarkdown(markdown: string): string {
  const raw = marked.parse(markdown) as string;
  return sanitizeHtml(raw, {
    allowedTags: ['p', 'ul', 'ol', 'li', 'a', 'strong', 'em', 'code', 'br'],
    allowedAttributes: { a: ['href', 'target', 'rel'] },
    allowedSchemes: ['https'],
    allowedSchemesAppliedToAttributes: ['href'],
    allowProtocolRelative: false,
    transformTags: {
      a: (tagName, attribs) => {
        const href = attribs.href;
        if (!href || !isRenderableHref(href)) return { tagName: 'span', attribs: {} as Record<string, string> };
        const out: Record<string, string> = { href };
        if (href.startsWith('http') || href.startsWith('/help/')) {
          out.target = '_blank';
          out.rel = 'noopener noreferrer';
        }
        return { tagName, attribs: out };
      },
      h1: 'p',
      h2: 'p',
      h3: 'p',
      h4: 'p',
      h5: 'p',
      h6: 'p',
      pre: 'p',
      blockquote: 'p',
    },
  });
}

export function AssistantMarkdown({
  markdown,
  onNavigateWithin,
}: {
  markdown: string;
  /** Called with the pathname when the person clicks a link inside the dashboard. */
  onNavigateWithin?: (pathname: string) => void;
}) {
  const html = useMemo(() => renderAssistantMarkdown(markdown), [markdown]);

  function handleClick(event: MouseEvent<HTMLDivElement>) {
    if (!onNavigateWithin) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const link = target.closest('a[href]');
    if (!(link instanceof HTMLAnchorElement)) return;
    const href = link.getAttribute('href') ?? '';
    if (!href.startsWith('/dashboard')) return;
    event.preventDefault();
    onNavigateWithin(href);
  }

  return <div className="assistant-prose text-sm leading-relaxed text-slate-800" onClick={handleClick} dangerouslySetInnerHTML={{ __html: html }} />;
}
