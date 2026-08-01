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

  it('splits on help-video markers', () => {
    const md = `Hello\n\n:::help-video services-setup\n\nWorld`;
    expect(splitMarkdownFigures(md)).toEqual([
      { kind: 'markdown', text: 'Hello' },
      { kind: 'video', id: 'services-setup' },
      { kind: 'markdown', text: 'World' },
    ]);
  });

  it('keeps figures and videos distinct when both appear', () => {
    const md = `:::help-figure service-row\n\n:::help-video services-setup`;
    expect(splitMarkdownFigures(md)).toEqual([
      { kind: 'figure', id: 'service-row' },
      { kind: 'video', id: 'services-setup' },
    ]);
  });

  it('leaves unknown ::: directives in the markdown', () => {
    const md = `A\n:::help-other x\nB`;
    expect(splitMarkdownFigures(md)).toEqual([{ kind: 'markdown', text: 'A\n:::help-other x\nB' }]);
  });

  it('strips markers for search text', () => {
    const md = `A\n:::help-figure x\nB\n:::help-video y\nC`;
    expect(stripHelpFigureMarkers(md)).toBe('A\nB\nC');
  });
});
