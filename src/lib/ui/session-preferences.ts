export function readSessionPreference<T>(
  key: string,
  fallback: T,
  isValid: (value: unknown) => value is T,
): T {
  if (typeof window === 'undefined') return fallback;

  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as unknown;
    return isValid(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function writeSessionPreference<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return;

  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore unavailable storage */
  }
}
