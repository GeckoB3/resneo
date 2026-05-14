export type HelpContentSegment =
  | { kind: 'markdown'; text: string }
  | { kind: 'figure'; id: string };

/** Removes `:::help-figure id` lines for search indexing and plain previews. */
export function stripHelpFigureMarkers(markdown: string): string {
  return markdown
    .split('\n')
    .filter((line) => !/^:::help-figure\s+[\w-]+\s*$/.test(line.trim()))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Splits markdown on single-line figure markers: `:::help-figure some-id`
 * Markers must occupy the full line (trimmed).
 */
export function splitMarkdownFigures(markdown: string): HelpContentSegment[] {
  const lines = markdown.split('\n');
  const segments: HelpContentSegment[] = [];
  const buf: string[] = [];

  function flushMd() {
    const t = buf.join('\n').trim();
    if (t) segments.push({ kind: 'markdown', text: t });
    buf.length = 0;
  }

  for (const line of lines) {
    const trimmed = line.trim();
    const m = trimmed.match(/^:::help-figure\s+([\w-]+)\s*$/);
    if (m) {
      flushMd();
      segments.push({ kind: 'figure', id: m[1] });
    } else {
      buf.push(line);
    }
  }
  flushMd();
  return segments;
}
