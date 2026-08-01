'use client';

import { Fragment } from 'react';
import { HelpArticleContent } from '@/components/help/HelpArticleContent';
import { HelpVideo } from '@/components/help/HelpVideo';
import { splitMarkdownFigures } from '@/lib/help/split-markdown-figures';
import { GettingStartedHelpFigure } from '@/components/help/getting-started-figures/GettingStartedHelpFigures';

export function GettingStartedHelpArticleBody({ markdown }: { markdown: string }) {
  const segments = splitMarkdownFigures(markdown);
  return (
    <div className="getting-started-help-article-body">
      {segments.map((seg, i) => (
        <Fragment key={i}>
          {seg.kind === 'markdown' ? (
            seg.text.trim() ? <HelpArticleContent markdown={seg.text} /> : null
          ) : seg.kind === 'video' ? (
            <HelpVideo id={seg.id} />
          ) : (
            <GettingStartedHelpFigure id={seg.id} />
          )}
        </Fragment>
      ))}
    </div>
  );
}
