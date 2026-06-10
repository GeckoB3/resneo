const SUFFIX_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_PREFIX_LEN = 16;
const MAX_ATTEMPTS = 10;

export function slugifyForSalesCode(name: string | null | undefined): string {
  const raw = (name ?? '').trim();
  const upper = raw.toUpperCase();
  const cleaned = upper
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const trimmed = cleaned.slice(0, MAX_PREFIX_LEN).replace(/-+$/g, '');
  if (!trimmed) return 'SALES';
  return trimmed;
}

export function randomSalesCodeSuffix(): string {
  let out = '';
  for (let i = 0; i < 4; i++) {
    const idx = Math.floor(Math.random() * SUFFIX_ALPHABET.length);
    out += SUFFIX_ALPHABET[idx];
  }
  return out;
}

export function buildCandidateSalesCode(displayName: string | null | undefined): string {
  return `${slugifyForSalesCode(displayName)}-${randomSalesCodeSuffix()}`;
}
