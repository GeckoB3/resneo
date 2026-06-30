import type { SupabaseClient } from '@supabase/supabase-js';
import { COMPLIANCE_BUCKET } from '@/lib/compliance/files';
import { removeStoragePrefix } from '@/lib/venue/venue-storage-cleanup';
import { writeComplianceAuditEvent } from '@/lib/compliance/audit';

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

    // 1b. Remove each form link's temp upload prefix (audit M8). A file uploaded against a
    // pending/abandoned/revoked/expired link is not referenced by any record, so step 1 misses
    // it; without this it would survive right-to-erasure. Best-effort per link.
    const { data: links } = await admin
      .from('compliance_form_links')
      .select('code')
      .eq('venue_id', venueId)
      .eq('guest_id', guestId);
    for (const l of (links ?? []) as Array<{ code?: string | null }>) {
      if (!l.code) continue;
      try {
        await removeStoragePrefix(admin, COMPLIANCE_BUCKET, `venues/${venueId}/uploads/${l.code}`);
      } catch (e) {
        console.error('[eraseGuestCompliance] link upload remove failed:', e instanceof Error ? e.message : e, {
          venueId,
          code: l.code,
        });
      }
    }

    // 2. Delete form links (prefill PII) and records (special-category responses).
    await admin.from('compliance_form_links').delete().eq('venue_id', venueId).eq('guest_id', guestId);
    await admin.from('compliance_records').delete().eq('venue_id', venueId).eq('guest_id', guestId);

    // 3. Record the erasure on the append-only audit trail (audit Low: accountability for the
    // destruction of special-category data). guest_id survives the anonymise flow; on a hard
    // delete it is SET NULL, leaving the counts for GDPR Article 30 record-keeping.
    await writeComplianceAuditEvent(admin, {
      venueId,
      eventType: 'guest.compliance_erased',
      actorType: 'system',
      guestId,
      metadata: { records_removed: records?.length ?? 0, links_removed: links?.length ?? 0 },
    });
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
