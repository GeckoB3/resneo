/**
 * Resolve a Supabase public object URL back to `{bucket}/{path}` for storage.remove().
 */
export function venueStorageObjectPathFromPublicUrl(
  publicUrl: string,
  bucket: string,
): string | null {
  const trimmed = publicUrl.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    const marker = `/storage/v1/object/public/${bucket}/`;
    const pathname = u.pathname;
    const idx = pathname.indexOf(marker);
    if (idx === -1) return null;
    const encodedPath = pathname.slice(idx + marker.length);
    if (!encodedPath) return null;
    return decodeURIComponent(encodedPath);
  } catch {
    return null;
  }
}
