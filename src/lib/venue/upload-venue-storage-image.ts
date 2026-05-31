import type { SupabaseClient } from '@supabase/supabase-js';
import type { ParsedImageUpload } from '@/lib/venue/parse-image-upload';

export async function uploadVenueStorageImage(
  admin: SupabaseClient,
  bucket: string,
  venueId: string,
  file: ParsedImageUpload,
): Promise<{ publicUrl: string } | { error: string }> {
  const path = `${venueId}/${crypto.randomUUID()}.${file.ext}`;
  const { data, error } = await admin.storage.from(bucket).upload(path, file.bytes, {
    contentType: file.contentType,
    upsert: false,
  });

  if (error) {
    const message = error.message?.trim() || 'Upload failed';
    const hint =
      message.toLowerCase().includes('bucket') || message.toLowerCase().includes('not found')
        ? `${message} (storage bucket "${bucket}" may be missing — apply Supabase migrations)`
        : message;
    console.error(`[uploadVenueStorageImage] ${bucket}:`, error);
    return { error: hint };
  }

  const { data: urlData } = admin.storage.from(bucket).getPublicUrl(data.path);
  return { publicUrl: urlData.publicUrl };
}
