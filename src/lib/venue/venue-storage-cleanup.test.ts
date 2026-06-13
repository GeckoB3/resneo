import { describe, it, expect } from 'vitest';
import { purgeVenueStorage, VENUE_STORAGE_TARGETS, type StorageLike } from './venue-storage-cleanup';

/** In-memory Supabase Storage fake: models folders via path segments the way `list` does. */
function makeFakeStorage(buckets: Record<string, string[]>, opts?: { failRemoveFor?: string }) {
  const state: Record<string, Set<string>> = {};
  for (const [b, paths] of Object.entries(buckets)) state[b] = new Set(paths);

  const storage: StorageLike = {
    from(bucket: string) {
      return {
        async list(prefix: string, options?: { limit?: number; offset?: number }) {
          const all = [...(state[bucket] ?? [])];
          const base = prefix ? `${prefix}/` : '';
          const files = new Map<string, true>();
          const folders = new Map<string, true>();
          for (const p of all) {
            if (base && !p.startsWith(base)) continue;
            const rest = p.slice(base.length);
            if (!rest) continue;
            const slash = rest.indexOf('/');
            if (slash === -1) files.set(rest, true);
            else folders.set(rest.slice(0, slash), true);
          }
          const entries = [
            ...[...folders.keys()].map((name) => ({ name, id: null as string | null })),
            ...[...files.keys()].map((name) => ({ name, id: `id:${base}${name}` as string | null })),
          ].sort((a, b) => a.name.localeCompare(b.name));
          const offset = options?.offset ?? 0;
          const limit = options?.limit ?? entries.length;
          return { data: entries.slice(offset, offset + limit), error: null };
        },
        async remove(paths: string[]) {
          if (opts?.failRemoveFor && bucket === opts.failRemoveFor) {
            return { error: { message: `remove blocked for ${bucket}` } };
          }
          for (const p of paths) state[bucket]?.delete(p);
          return { error: null };
        },
      };
    },
  };

  return { storage, state };
}

const VENUE = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';

describe('VENUE_STORAGE_TARGETS', () => {
  it('scopes compliance-files under venues/{id} and everything else under {id}', () => {
    const compliance = VENUE_STORAGE_TARGETS.find((t) => t.bucket === 'compliance-files');
    expect(compliance?.prefix(VENUE)).toBe(`venues/${VENUE}`);
    for (const t of VENUE_STORAGE_TARGETS) {
      if (t.bucket === 'compliance-files') continue;
      expect(t.prefix(VENUE)).toBe(VENUE);
    }
  });
});

describe('purgeVenueStorage', () => {
  it('removes all of a venue\'s objects (incl. nested) and leaves other venues untouched', async () => {
    const { storage, state } = makeFakeStorage({
      'venue-covers': [`${VENUE}/cover.jpg`, `${OTHER}/cover.jpg`],
      'guest-documents': [
        `${VENUE}/guest-a/doc-1/passport.pdf`,
        `${VENUE}/guest-b/doc-2/form.pdf`,
        `${OTHER}/guest-c/doc-3/keep.pdf`,
      ],
      'imports': [`${VENUE}/session-1/2026_data.csv`, `${VENUE}/session-1/2026_data.original.csv`],
      'compliance-files': [
        `venues/${VENUE}/uploads/abc/sig.png`,
        `venues/${VENUE}/signatures/rec-1.png`,
        `venues/${OTHER}/uploads/xyz/sig.png`,
      ],
    });

    const result = await purgeVenueStorage({ storage }, VENUE);

    expect(result.errors).toEqual([]);
    expect(result.removed).toBe(7);
    // Target venue fully purged across buckets:
    expect([...state['venue-covers']]).toEqual([`${OTHER}/cover.jpg`]);
    expect([...state['guest-documents']]).toEqual([`${OTHER}/guest-c/doc-3/keep.pdf`]);
    expect([...state['imports']]).toEqual([]);
    expect([...state['compliance-files']]).toEqual([`venues/${OTHER}/uploads/xyz/sig.png`]);
  });

  it('reports a per-bucket error without throwing or aborting other buckets', async () => {
    const { storage, state } = makeFakeStorage(
      {
        'venue-covers': [`${VENUE}/cover.jpg`],
        'guest-documents': [`${VENUE}/g/d/file.pdf`],
      },
      { failRemoveFor: 'guest-documents' },
    );

    const result = await purgeVenueStorage({ storage }, VENUE);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].bucket).toBe('guest-documents');
    // The healthy bucket was still purged.
    expect([...state['venue-covers']]).toEqual([]);
    // The failing bucket's object remains (so the caller can retry).
    expect([...state['guest-documents']]).toEqual([`${VENUE}/g/d/file.pdf`]);
  });
});
