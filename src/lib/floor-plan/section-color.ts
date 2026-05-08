/**
 * Deterministic accent colour for server section labels (floor overlay).
 */
export function stringToAccentHex(label: string): string {
  const s = label.trim().toLowerCase();
  if (!s) return '#64748b';
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  const hue = h % 360;
  return `hsl(${hue} 55% 42%)`;
}
