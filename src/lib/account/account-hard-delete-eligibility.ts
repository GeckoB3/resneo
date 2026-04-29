/**
 * Pure helper: profiles whose `deleted_at` (scheduled hard-delete moment) is on or before `now`.
 * Mirrors the cron route query intent for unit tests.
 */
export function filterUserIdsDueForHardDelete(
  profiles: Array<{ id: string; deleted_at: string | null }>,
  nowIso: string,
): string[] {
  return (profiles ?? [])
    .filter((p) => p.deleted_at != null && p.deleted_at <= nowIso)
    .map((p) => p.id);
}
