/**
 * Ask ResNeo switches (Docs/help-assistant-plan.md, 3.2 and 3.6).
 *
 * `ASSISTANT_ENABLED` is the kill switch: anything but exactly "true" and the route answers
 * 404 and the launcher is not rendered. `ASSISTANT_VENUE_ALLOWLIST` (comma-separated venue
 * ids) narrows the beta; empty means every venue. `ASSISTANT_DAILY_CAP` bounds the worst
 * case per venue per day.
 */

export function assistantEnabled(): boolean {
  return process.env.ASSISTANT_ENABLED?.trim() === 'true';
}

export function assistantVenueAllowlist(): string[] {
  return (process.env.ASSISTANT_VENUE_ALLOWLIST ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function assistantEnabledFor(venueId: string | null | undefined): boolean {
  if (!assistantEnabled()) return false;
  const list = assistantVenueAllowlist();
  if (list.length === 0) return true;
  return Boolean(venueId && list.includes(venueId));
}

export const DEFAULT_ASSISTANT_DAILY_CAP = 200;

export function assistantDailyCap(): number {
  const raw = Number.parseInt(process.env.ASSISTANT_DAILY_CAP ?? '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_ASSISTANT_DAILY_CAP;
}

export const DEFAULT_ASSISTANT_RETENTION_DAYS = 30;

export function assistantRetentionDays(): number {
  const raw = Number.parseInt(process.env.ASSISTANT_RETENTION_DAYS ?? '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_ASSISTANT_RETENTION_DAYS;
}
