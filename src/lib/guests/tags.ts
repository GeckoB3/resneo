export const MAX_TAGS_PER_GUEST = 20;
export const MAX_GUEST_TAG_LENGTH = 30;

/** Normalise a single tag from URL or UI for filtering (trim, lowercase, length cap). */
export function normaliseSegmentTagFilter(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const s = raw.trim().toLowerCase();
  if (!s || s.length > MAX_GUEST_TAG_LENGTH) return null;
  return s;
}

/** Normalise tag list: trim, dedupe case-insensitively, cap count and length. */
export function normaliseGuestTagsInput(raw: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of raw) {
    const s = String(t).trim();
    if (!s || s.length > MAX_GUEST_TAG_LENGTH) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s.toLowerCase());
    if (out.length >= MAX_TAGS_PER_GUEST) break;
  }
  return out;
}
