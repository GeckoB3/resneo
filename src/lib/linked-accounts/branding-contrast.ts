/**
 * Contrast guards for host-chosen collective branding (§19.4).
 *
 * The public collective page (`/book/c/{slug}`) paints a header in the host's
 * chosen `primary_colour` with white text and a white logo chip. A host can
 * pick any colour, including a pale one on which white text is unreadable. We
 * never reject their choice outright — instead we auto-adjust it: the hue is
 * preserved but darkened just enough that white text clears WCAG AA. This keeps
 * the page legible without a validation dead-end during setup.
 */

const HEX6 = /^#[0-9a-fA-F]{6}$/;

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function hexToRgb(hex: string): Rgb | null {
  if (!HEX6.test(hex)) return null;
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

function rgbToHex({ r, g, b }: Rgb): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** WCAG relative luminance for an 8-bit sRGB colour. */
export function relativeLuminance({ r, g, b }: Rgb): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two colours (order-independent), 1–21. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

const WHITE: Rgb = { r: 255, g: 255, b: 255 };

/**
 * Return an accent colour on which white text reaches at least `minRatio`
 * (default 4.5 — AA for normal text). If the input already passes it's returned
 * unchanged; otherwise the hue is darkened toward black in small steps until it
 * does. Invalid/empty input falls back to {@link fallback}.
 */
export function readableAccentForWhiteText(
  hex: string | null | undefined,
  fallback = '#003B6F',
  minRatio = 4.5,
): string {
  const rgb = hexToRgb((hex ?? '').trim()) ?? hexToRgb(fallback);
  if (!rgb) return fallback;
  if (contrastRatio(rgb, WHITE) >= minRatio) return rgbToHex(rgb);

  // Darken multiplicatively toward black; ~40 steps of 6% reaches near-black,
  // which always clears the ratio, so the loop is bounded.
  let cur = { ...rgb };
  for (let i = 0; i < 40; i += 1) {
    cur = { r: cur.r * 0.94, g: cur.g * 0.94, b: cur.b * 0.94 };
    if (contrastRatio(cur, WHITE) >= minRatio) break;
  }
  return rgbToHex(cur);
}
