import { describe, expect, it } from 'vitest';
import { splitMarkdownFigures, stripHelpFigureMarkers } from './split-markdown-figures';

describe('splitMarkdownFigures', () => {
  it('splits on help-figure markers', () => {
    const md = `Hello\n\n:::help-figure tier-compare\n\nWorld`;
    expect(splitMarkdownFigures(md)).toEqual([
      { kind: 'markdown', text: 'Hello' },
      { kind: 'figure', id: 'tier-compare' },
      { kind: 'markdown', text: 'World' },
    ]);
  });

  it('strips markers for search text', () => {
    const md = `A\n:::help-figure x\nB`;
    expect(stripHelpFigureMarkers(md)).toBe('A\nB');
  });
});
