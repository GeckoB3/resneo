'use client';

import { useMemo } from 'react';
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

marked.setOptions({
  gfm: true,
  breaks: false,
});

export function HelpArticleContent({ markdown }: { markdown: string }) {
  const html = useMemo(() => {
    const raw = marked.parse(markdown) as string;
    const sanitized = sanitizeHtml(raw, {
      allowedTags: [
        'h1',
        'h2',
        'h3',
        'h4',
        'h5',
        'h6',
        'p',
        'ul',
        'ol',
        'li',
        'a',
        'strong',
        'em',
        'code',
        'pre',
        'blockquote',
        'hr',
        'br',
        'table',
        'thead',
        'tbody',
        'tr',
        'th',
        'td',
      ],
      allowedAttributes: {
        a: ['href', 'target', 'rel'],
      },
      allowedSchemes: ['http', 'https', 'mailto', 'tel'],
      transformTags: {
        a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }),
      },
    });

    // Article pages already render an outer page title. Demote markdown H1s for proper outline.
    return sanitized
      .replace(/<h1\b/g, '<h2')
      .replace(/<\/h1>/g, '</h2>');
  }, [markdown]);

  return (
    <div
      className="help-prose text-slate-800"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
