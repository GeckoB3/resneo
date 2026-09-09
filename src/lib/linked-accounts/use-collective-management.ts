'use client';

import { useCallback, useEffect, useState } from 'react';
import type { CollectiveView } from './collectives';
import type { AccountLinkView } from './types';
import { fullMutualLinks } from './full-mutual-links';

export interface CollectiveManagementData {
  /** The live collective asked for, or null once loaded if it is gone (dissolved, left). */
  collective: CollectiveView | null;
  /** Linked venues the host may invite: full mutual links. */
  eligibleLinks: AccountLinkView[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * What the Booking Page tab needs to manage (or describe) one collective inline:
 * the collective view from `GET /api/venue/collectives` and the invitable links
 * from `GET /api/venue/account-links`. The Linked accounts tab keeps its own
 * loading because it lists every collective, invitations included.
 */
export function useCollectiveManagement(collectiveId: string | null): CollectiveManagementData {
  const [collective, setCollective] = useState<CollectiveView | null>(null);
  const [eligibleLinks, setEligibleLinks] = useState<AccountLinkView[]>([]);
  const [loading, setLoading] = useState(collectiveId != null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!collectiveId) return;
    setLoading(true);
    try {
      const [collectivesRes, linksRes] = await Promise.all([
        fetch('/api/venue/collectives'),
        fetch('/api/venue/account-links'),
      ]);
      const collectivesJson = await collectivesRes.json();
      if (!collectivesRes.ok) throw new Error(collectivesJson.error ?? 'Failed to load the collective.');
      const list: CollectiveView[] = collectivesJson.collectives ?? [];
      setCollective(list.find((c) => c.id === collectiveId && c.status !== 'dissolved') ?? null);
      // Links are only needed for the host's Members tab; a failure there must
      // not hide the whole page.
      if (linksRes.ok) {
        const linksJson = await linksRes.json();
        const links: AccountLinkView[] = linksJson.links ?? [];
        setEligibleLinks(fullMutualLinks(links));
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load the collective.');
    } finally {
      setLoading(false);
    }
  }, [collectiveId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { collective, eligibleLinks, loading, error, refresh };
}
