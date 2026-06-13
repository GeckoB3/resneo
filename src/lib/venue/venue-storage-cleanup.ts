import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Every storage bucket that holds venue-owned objects, with the path prefix that scopes
 * objects to a single venue. Most buckets key objects under `{venueId}/...`; compliance-files
 * uses `venues/{venueId}/...` (see src/app/api/public/compliance/forms/[code]/file/route.ts).
 *
 * Keep this list in sync with new venue storage buckets — a missed bucket means orphaned
 * personal data survives venue deletion.
 */
export const VENUE_STORAGE_TARGETS: ReadonlyArray<{
  bucket: string;
  prefix: (venueId: string) => string;
}> = [
  { bucket: 'venue-covers', prefix: (id) => id },
  { bucket: 'venue-logos', prefix: (id) => id },
  { bucket: 'venue-gallery', prefix: (id) => id },
  { bucket: 'venue-team-photos', prefix: (id) => id },
  { bucket: 'venue-service-photos', prefix: (id) => id },
  { bucket: 'floor-plan-backgrounds', prefix: (id) => id },
  { bucket: 'guest-documents', prefix: (id) => id },
  { bucket: 'imports', prefix: (id) => id },
  { bucket: 'compliance-files', prefix: (id) => `venues/${id}` },
];

const LIST_PAGE_SIZE = 100;
const REMOVE_CHUNK_SIZE = 100;
const MAX_DEPTH = 16;

/** Minimal shape of the Supabase Storage client this module needs (eases testing). */
export interface StorageLike {
  from(bucket: string): {
    list(
      path: string,
      options?: { limit?: number; offset?: number },
    ): Promise<{ data: Array<{ name: string; id: string | null }> | null; error: { message: string } | null }>;
    remove(
      paths: string[],
    ): Promise<{ data?: unknown; error: { message: string } | null }>;
  };
}

type AdminClientLike = { storage: StorageLike } | SupabaseClient;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Recursively collect the full object paths under `prefix` in a bucket. Supabase `list`
 * returns folders as entries with `id === null`; we descend into those.
 */
async function listAllObjectPaths(
  storage: StorageLike,
  bucket: string,
  prefix: string,
  depth = 0,
): Promise<string[]> {
  if (depth > MAX_DEPTH) {
    throw new Error(`max folder depth exceeded under ${bucket}/${prefix}`);
  }

  const paths: string[] = [];
  let offset = 0;

  for (;;) {
    const { data, error } = await storage
      .from(bucket)
      .list(prefix, { limit: LIST_PAGE_SIZE, offset });
    if (error) {
      throw new Error(error.message);
    }
    const entries = data ?? [];
    for (const entry of entries) {
      const entryPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null) {
        const nested = await listAllObjectPaths(storage, bucket, entryPath, depth + 1);
        paths.push(...nested);
      } else {
        paths.push(entryPath);
      }
    }
    if (entries.length < LIST_PAGE_SIZE) break;
    offset += entries.length;
  }

  return paths;
}

export interface PurgeVenueStorageResult {
  removed: number;
  errors: Array<{ bucket: string; error: string }>;
}

/**
 * Delete every storage object belonging to a venue across all venue buckets. Returns the
 * count removed and any per-bucket errors. A bucket error does not abort the others — the
 * caller decides whether partial failure should block the DB hard-delete (it should, so the
 * venue stays in the queue and the purge is retried rather than orphaning objects forever).
 */
export async function purgeVenueStorage(
  admin: AdminClientLike,
  venueId: string,
): Promise<PurgeVenueStorageResult> {
  const storage = (admin as { storage: StorageLike }).storage;
  let removed = 0;
  const errors: Array<{ bucket: string; error: string }> = [];

  for (const target of VENUE_STORAGE_TARGETS) {
    try {
      const paths = await listAllObjectPaths(storage, target.bucket, target.prefix(venueId));
      for (const batch of chunk(paths, REMOVE_CHUNK_SIZE)) {
        const { error } = await storage.from(target.bucket).remove(batch);
        if (error) throw new Error(error.message);
        removed += batch.length;
      }
    } catch (e) {
      errors.push({ bucket: target.bucket, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return { removed, errors };
}
