import type { SupabaseClient } from '@supabase/supabase-js';
import { COMPLIANCE_BUCKET } from '@/lib/compliance/files';

/**
 * Erase a guest's compliance data for a GDPR right-to-erasure (spec §13.1).
 *
 * The venue erase pipeline anonymises the guest row rather than deleting it, so
 * the `ON DELETE CASCADE` on compliance_records never fires. We therefore remove
 * the storage objects (signatures + file uploads) AND delete the records and
 * form links explicitly. Compliance records hold special-category data, so this
 * is load-bearing for erasure. Audit events keep `guest_id` (SET NULL on actual
 * deletion) but carry no free-text PII.
 *
 * Best-effort and defensive: a failure here must not block the wider erase.
 */
export async function eraseGuestCompliance(
  admin: SupabaseClient,
  venueId: string,
  guestId: string,
): Promise<void> {
  try {
    // 1. Collect storage paths referenced by this guest's records.
    const { data: records } = await admin
      .from('compliance_records')
      .select('responses')
      .eq('venue_id', venueId)
      .eq('guest_id', guestId);

    const paths = new Set<string>();
    for (const r of (records ?? []) as Array<{ responses?: unknown }>) {
      collectStoragePaths(r.responses, paths);
    }
    if (paths.size > 0) {
      const { error } = await admin.storage.from(COMPLIANCE_BUCKET).remove([...paths]);
      if (error) {
        console.error('[eraseGuestCompliance] storage remove failed:', error.message, { venueId, guestId });
      }
    }

    // 2. Delete form links (prefill PII) and records (special-category responses).
    await admin.from('compliance_form_links').delete().eq('venue_id', venueId).eq('guest_id', guestId);
    await admin.from('compliance_records').delete().eq('venue_id', venueId).eq('guest_id', guestId);
  } catch (err) {
    console.error('[eraseGuestCompliance] failed:', err instanceof Error ? err.message : err, { venueId, guestId });
  }
}

/** Walk a responses JSONB document and collect any `storage_path` strings (signatures + files). */
function collectStoragePaths(responses: unknown, out: Set<string>): void {
  if (!responses || typeof responses !== 'object') return;
  for (const value of Object.values(responses as Record<string, unknown>)) {
    if (value && typeof value === 'object') {
      const sp = (value as { storage_path?: unknown }).storage_path;
      if (typeof sp === 'string' && sp.trim()) out.add(sp);
    }
  }
}
