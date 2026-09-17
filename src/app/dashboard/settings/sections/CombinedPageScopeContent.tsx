'use client';

import { useRouter } from 'next/navigation';
import { useCallback } from 'react';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import {
  COMBINED_PAGE_DESCRIPTION_LEGACY,
  COMBINED_PAGE_DESCRIPTION_SHARED,
  CombinedPageManagerPanel,
  CombinedPageMemberSummary,
} from '@/components/linked-accounts/CombinedPageManager';
import { useCollectiveManagement } from '@/lib/linked-accounts/use-collective-management';
import type { SettingsCollectiveNote } from './CombinedPageNotice';

/**
 * The Booking Page tab's combined-page scope: the host's manager rendered
 * inline (page, services & calendars, members), or a member's read-only
 * summary. Loads the collective view itself and refreshes the server tree
 * after a write so the sidebar's combined-page link and the tab's collective
 * note keep up.
 */
export function CombinedPageScopeContent({
  collective,
  onPendingChange,
}: {
  collective: SettingsCollectiveNote;
  /** The number of staged calendar changes, so the tab can warn before leaving. */
  onPendingChange?: (count: number) => void;
}) {
  const router = useRouter();
  const { collective: view, eligibleLinks, loading, error, refresh } = useCollectiveManagement(collective.id);
  const changed = useCallback(() => {
    void refresh();
    router.refresh();
  }, [refresh, router]);

  return (
    <SectionCard>
      <SectionCard.Header
        eyebrow="Combined booking page"
        title={collective.name}
        description={
          collective.isHost
            ? view?.serviceModel === 'replicas' || collective.ownPage
              ? COMBINED_PAGE_DESCRIPTION_SHARED
              : COMBINED_PAGE_DESCRIPTION_LEGACY
            : `This combined page is managed by ${collective.hostVenueName}.`
        }
      />
      <SectionCard.Body className="!px-2 sm:!px-6">
        {view ? (
          view.isHost ? (
            <CombinedPageManagerPanel
              inline
              collective={view}
              eligibleLinks={eligibleLinks}
              onChanged={changed}
              onPendingChange={onPendingChange}
            />
          ) : (
            <CombinedPageMemberSummary collective={view} />
          )
        ) : error ? (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">
            {error}
          </p>
        ) : loading ? (
          <div className="space-y-2" aria-busy="true">
            <span className="sr-only">Loading the combined page…</span>
            <div className="skeleton h-20 rounded-xl" />
            <div className="skeleton h-20 rounded-xl" />
          </div>
        ) : (
          <p className="text-sm text-slate-600">
            This collective is no longer live. Refresh the page to see this venue’s own booking page settings.
          </p>
        )}
      </SectionCard.Body>
    </SectionCard>
  );
}
