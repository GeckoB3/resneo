import type { SupabaseClient } from '@supabase/supabase-js';
import { venueStorageObjectPathFromPublicUrl } from '@/lib/venue/venue-storage-url';

/**
 * Delete a venue-owned object from storage using its public URL.
 * Returns false when the URL is not for this bucket/venue (no-op).
 */
export async function deleteVenueStorageImageByPublicUrl(
  admin: SupabaseClient,
  bucket: string,
  venueId: string,
  publicUrl: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const objectPath = venueStorageObjectPathFromPublicUrl(publicUrl, bucket);
  if (!objectPath) {
    return { ok: false, error: 'Unrecognised image URL' };
  }
  const prefix = `${venueId}/`;
  if (!objectPath.startsWith(prefix)) {
    return { ok: false, error: 'Image does not belong to this venue' };
  }

  const { error } = await admin.storage.from(bucket).remove([objectPath]);
  if (error) {
    console.error(`[deleteVenueStorageImageByPublicUrl] ${bucket}/${objectPath}:`, error);
    return { ok: false, error: error.message?.trim() || 'Failed to delete image' };
  }
  return { ok: true };
}
