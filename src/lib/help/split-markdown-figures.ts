export type HelpContentSegment =
  | { kind: 'markdown'; text: string }
  | { kind: 'figure'; id: string }
  | { kind: 'video'; id: string };

/** Matches a whole-line block marker, e.g. `:::help-figure tier-compare`. */
const MARKER = /^:::help-(figure|video)\s+([\w-]+)\s*$/;

/** Removes `:::help-figure id` and `:::help-video id` lines for search indexing and plain previews. */
export function stripHelpFigureMarkers(markdown: string): string {
  return markdown
    .split('\n')
    .filter((line) => !MARKER.test(line.trim()))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Splits markdown on single-line block markers:
 *   `:::help-figure some-id`  hand-built SVG schematic
 *   `:::help-video some-id`   embedded walkthrough video
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
    const m = trimmed.match(MARKER);
    if (m) {
      flushMd();
      segments.push({ kind: m[1] === 'video' ? 'video' : 'figure', id: m[2] });
    } else {
      buf.push(line);
    }
  }
  flushMd();
  return segments;
}
