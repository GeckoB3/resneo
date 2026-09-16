'use client';

/**
 * The Collective area's Services tab (UX spec §2 item 15; W5).
 *
 * One read answers the whole page: the Services API already returns what each service is to the
 * collective, and, for a host admin, every venue's calendars and what they offer. From that comes
 * the health strip, "What needs you" and the grid, with no second endpoint to keep in step.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/ui/dashboard/PageHeader';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import { DashboardCardGridSkeleton } from '@/components/ui/dashboard/DashboardSkeletons';
import { Button } from '@/components/ui/primitives/Button';
import { VenueSyncPill } from '@/components/linked-accounts/collective/CollectivePills';
import { CollectiveTodoStrip } from '@/components/linked-accounts/collective/CollectiveTodoStrip';
import { CollectiveServicesGrid } from '@/components/linked-accounts/collective/CollectiveServicesGrid';
import { buildCollectiveTodos } from '@/lib/linked-accounts/replicas/collective-todos';
import { collectiveCopy } from '@/lib/linked-accounts/collective-copy';
import { currencySymbolFromCode } from '@/lib/money/currency-symbol';
import type { CollectiveCalendarGroup } from '@/lib/linked-accounts/replicas/host-calendars';
import type { CollectiveServiceBlock } from '@/lib/linked-accounts/replicas/service-blocks';
import type { BulkOp, BulkOpResult } from '@/lib/linked-accounts/replicas/bulk-ops';
import type { PreviewVenue } from '@/lib/linked-accounts/replicas/bulk-preview';

interface ServiceRow {
  id: string;
  name: string;
  collective?: CollectiveServiceBlock | null;
}

export function CollectiveAreaClient({ currency = 'GBP' }: { currency?: string }) {
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [groups, setGroups] = useState<CollectiveCalendarGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/venue/appointment-services');
      if (!res.ok) {
        setError('Could not load the collective. Please refresh the page.');
        return;
      }
      const data = (await res.json()) as {
        services?: ServiceRow[];
        collective_calendars?: CollectiveCalendarGroup[];
      };
      setServices(data.services ?? []);
      setGroups(data.collective_calendars ?? []);
    } catch {
      setError('Could not load the collective. Please check your connection.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const collective = useMemo(() => {
    const block = services.find((s) => s.collective)?.collective ?? null;
    if (!block) return null;
    const isHost = services.some((s) => s.collective?.role === 'master');
    return { id: block.collective_id, name: block.collective_name, hostVenueName: block.host_venue_name, isHost };
  }, [services]);

  const todos = useMemo(() => {
    if (!collective) return [];
    return buildCollectiveTodos({
      isHost: collective.isHost,
      services: services.map((s) => ({ id: s.id, name: s.name, collective: s.collective ?? null })),
      calendarGroups: groups,
    });
  }, [collective, services, groups]);

  const commit = useCallback(
    async (ops: BulkOp[]): Promise<BulkOpResult[]> => {
      if (!collective) return [];
      const res = await fetch(`/api/venue/collectives/${collective.id}/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ops }),
      });
      if (!res.ok) {
        // The whole chunk was refused: report every operation in it as not done, so nothing is
        // quietly dropped and the grid keeps them all staged.
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        return ops.map((_op, index) => ({ index, ok: false, message: data.error ?? 'That save did not go through.' }));
      }
      const data = (await res.json()) as { results?: BulkOpResult[] };
      return data.results ?? [];
    },
    [collective],
  );

  const previewOps = useCallback(
    async (ops: BulkOp[]): Promise<PreviewVenue[]> => {
      if (!collective) return [];
      const res = await fetch(`/api/venue/collectives/${collective.id}/bulk/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ops }),
      });
      if (!res.ok) throw new Error('preview failed');
      const data = (await res.json()) as { venues?: PreviewVenue[] };
      return data.venues ?? [];
    },
    [collective],
  );

  const retryVenue = useCallback(
    async (venueId: string) => {
      if (!collective) return;
      await fetch(`/api/venue/collectives/${collective.id}/replicas/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venue_id: venueId }),
      });
      await load();
    },
    [collective, load],
  );

  if (loading) return <DashboardCardGridSkeleton cards={2} />;

  if (error) {
    return (
      <SectionCard elevated>
        <SectionCard.Body className="py-8 text-center">
          <p className="text-sm text-rose-700">{error}</p>
          <Button type="button" variant="secondary" size="sm" className="mt-3" onClick={() => void load()}>
            Try again
          </Button>
        </SectionCard.Body>
      </SectionCard>
    );
  }

  if (!collective) {
    return (
      <SectionCard elevated>
        <SectionCard.Body className="py-10 text-center">
          <p className="text-slate-600">
            Your venue is not part of a collective yet. When it is, this is where you will run it.
          </p>
        </SectionCard.Body>
      </SectionCard>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Collective" title={collective.name} subtitle={collectiveCopy('ov.subtitle')} />

      {groups.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map((group) => {
            const behind = group.sync.pending.length > 0;
            const failed = group.sync.failed.length > 0;
            const calendars = group.calendars.filter((c) => c.is_active).length;
            const onPage = new Set(
              group.calendars.flatMap((c) => c.assigned.map((a) => a.item_id)),
            ).size;
            return (
              <SectionCard key={group.venue_id}>
                <SectionCard.Body className="space-y-1.5 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-900">
                      {group.is_host ? collectiveCopy('svc.cal.venueYou', { venue: group.venue_name }) : group.venue_name}
                    </p>
                    <VenueSyncPill
                      status={failed ? 'failed' : behind ? 'updating' : 'up_to_date'}
                      reason={failed ? group.sync.failed[0]!.message : null}
                    />
                  </div>
                  <p className="text-xs text-slate-600">
                    {collectiveCopy('ov.venue.counts', { services: onPage, calendars })}
                  </p>
                  {failed ? (
                    <Button type="button" variant="link" size="sm" onClick={() => void retryVenue(group.venue_id)}>
                      {collectiveCopy('svc.save.retry')}
                    </Button>
                  ) : null}
                </SectionCard.Body>
              </SectionCard>
            );
          })}
        </div>
      ) : null}

      <CollectiveTodoStrip todos={todos} onRetry={(venueId) => void retryVenue(venueId)} />

      <SectionCard elevated>
        <SectionCard.Body>
          <CollectiveServicesGrid
            services={services.map((s) => ({ id: s.id, name: s.name, collective: s.collective ?? null }))}
            groups={groups}
            currencySymbol={currencySymbolFromCode(currency)}
            onCommit={commit}
            onPreview={previewOps}
            onSaved={() => void load()}
          />
        </SectionCard.Body>
      </SectionCard>
    </div>
  );
}
