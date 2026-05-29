/** Maximum inactivity before auto-logout, and default for new venues (7 days). */
export const SESSION_TIMEOUT_DEFAULT_MINUTES = 7 * 24 * 60;

export const SESSION_TIMEOUT_MIN_MINUTES = 30;

export function normalizeSessionTimeoutMinutes(raw: number | null | undefined): number {
  if (raw == null || raw <= 0) return SESSION_TIMEOUT_DEFAULT_MINUTES;
  return Math.min(raw, SESSION_TIMEOUT_DEFAULT_MINUTES);
}
