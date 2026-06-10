import type { SupabaseClient } from '@supabase/supabase-js';

export type AnnouncementSeverity = 'info' | 'warning' | 'critical';

export interface ActiveAnnouncement {
  id: string;
  title: string;
  body: string;
  severity: AnnouncementSeverity;
}

/**
 * Active, in-window announcements that the given user has not dismissed.
 * Used by the venue dashboard layout (server-side, admin client).
 */
export async function loadActiveAnnouncementsForUser(
  admin: SupabaseClient,
  userId: string,
): Promise<ActiveAnnouncement[]> {
  const nowIso = new Date().toISOString();

  const [{ data: announcements, error: aErr }, { data: dismissals, error: dErr }] =
    await Promise.all([
      admin
        .from('platform_announcements')
        .select('id, title, body, severity, ends_at')
        .eq('active', true)
        .lte('starts_at', nowIso)
        .order('created_at', { ascending: false })
        .limit(10),
      admin
        .from('platform_announcement_dismissals')
        .select('announcement_id')
        .eq('user_id', userId),
    ]);

  if (aErr) {
    console.error('[announcements] load failed:', aErr.message);
    return [];
  }
  if (dErr) {
    console.error('[announcements] dismissals load failed:', dErr.message);
  }

  const dismissed = new Set((dismissals ?? []).map((d) => (d as { announcement_id: string }).announcement_id));

  return ((announcements ?? []) as Array<{
    id: string;
    title: string;
    body: string;
    severity: string;
    ends_at: string | null;
  }>)
    .filter((a) => !dismissed.has(a.id))
    .filter((a) => !a.ends_at || a.ends_at > nowIso)
    .map((a) => ({
      id: a.id,
      title: a.title,
      body: a.body,
      severity: (['info', 'warning', 'critical'].includes(a.severity)
        ? a.severity
        : 'info') as AnnouncementSeverity,
    }));
}
