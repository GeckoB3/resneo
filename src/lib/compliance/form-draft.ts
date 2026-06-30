/**
 * Best-effort localStorage persistence for in-progress compliance form input, so a
 * client who reloads, rotates their phone, or drops their connection resumes instead
 * of restarting (improvement plan §10, U10). All access is SSR-guarded and wrapped so
 * a disabled or full store never throws; drafts auto-expire after MAX_AGE_MS.
 */

const PREFIX = 'resneo.compliance.draft.';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface StoredDraft {
  savedAt: number;
  values: Record<string, unknown>;
}

function store(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    // Accessing localStorage can throw in some privacy modes.
    return null;
  }
}

/** Read a saved draft, or null if absent, expired, or unreadable. */
export function loadFormDraft(key: string): Record<string, unknown> | null {
  const s = store();
  if (!s || !key) return null;
  try {
    const raw = s.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredDraft;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.savedAt !== 'number') return null;
    if (Date.now() - parsed.savedAt > MAX_AGE_MS) {
      s.removeItem(PREFIX + key);
      return null;
    }
    return parsed.values && typeof parsed.values === 'object' ? parsed.values : null;
  } catch {
    return null;
  }
}

/** Persist a draft. Best-effort: a quota or serialization failure is swallowed. */
export function saveFormDraft(key: string, values: Record<string, unknown>): void {
  const s = store();
  if (!s || !key) return;
  try {
    const payload: StoredDraft = { savedAt: Date.now(), values };
    s.setItem(PREFIX + key, JSON.stringify(payload));
  } catch {
    // quota exceeded / serialization — ignore.
  }
}

/** Remove a single draft. */
export function clearFormDraft(key: string): void {
  const s = store();
  if (!s || !key) return;
  try {
    s.removeItem(PREFIX + key);
  } catch {
    // ignore
  }
}

/** Remove every draft whose key starts with `prefix` (e.g. all of one booking session). */
export function clearFormDraftsByPrefix(prefix: string): void {
  const s = store();
  if (!s || !prefix) return;
  try {
    const full = PREFIX + prefix;
    const toRemove: string[] = [];
    for (let i = 0; i < s.length; i += 1) {
      const k = s.key(i);
      if (k && k.startsWith(full)) toRemove.push(k);
    }
    for (const k of toRemove) s.removeItem(k);
  } catch {
    // ignore
  }
}
