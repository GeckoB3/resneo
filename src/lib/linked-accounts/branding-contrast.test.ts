import { describe, expect, it } from 'vitest';
import { contrastRatio, readableAccentForWhiteText } from './branding-contrast';

// Re-derive rgb the same way the module does for assertions.
function rgb(hex: string) {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}
const WHITE = { r: 255, g: 255, b: 255 };

describe('readableAccentForWhiteText', () => {
  it('leaves a sufficiently dark accent unchanged', () => {
    expect(readableAccentForWhiteText('#003B6F')).toBe('#003b6f');
  });

  it('darkens a pale accent until white text clears AA (4.5:1)', () => {
    const out = readableAccentForWhiteText('#FFE066'); // pale yellow — white text unreadable
    expect(out).not.toBe('#ffe066');
    expect(contrastRatio(rgb(out), WHITE)).toBeGreaterThanOrEqual(4.5);
  });

  it('darkens pure white all the way to a legible grey', () => {
    const out = readableAccentForWhiteText('#FFFFFF');
    expect(contrastRatio(rgb(out), WHITE)).toBeGreaterThanOrEqual(4.5);
  });

  it('falls back on invalid input (normalised to lowercase hex)', () => {
    expect(readableAccentForWhiteText('not-a-colour')).toBe('#003b6f');
    expect(readableAccentForWhiteText(null)).toBe('#003b6f');
    expect(readableAccentForWhiteText('')).toBe('#003b6f');
  });

  it('preserves hue while darkening (stays more blue than red for a blue input)', () => {
    const out = readableAccentForWhiteText('#7FB2FF'); // pale blue
    const { r, b } = rgb(out);
    expect(b).toBeGreaterThan(r);
  });
});
