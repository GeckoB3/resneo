'use client';

/**
 * The Collective area's Services tab (UX spec §2 item 15; W5).
 *
 * One read answers the whole page: the Services API already returns what each service is to the
 * collective, and, for a host admin, every venue's calendars and what they offer. From that comes
 * the health strip, "What needs you" and the grid, with no second endpoint to keep in step.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { PageHeader } from '@/components/ui/dashboard/PageHeader';
import { TabBar } from '@/components/ui/dashboard/TabBar';
import { CollectiveHistoryPanel } from '@/components/linked-accounts/collective/CollectiveHistoryPanel';
import {
  CollectiveVenuesPanel,
  type CollectiveVenueRow,
} from '@/components/linked-accounts/collective/CollectiveVenuesPanel';
import {
  HostingRequestBanner,
  PausedHostingBanner,
} from '@/components/linked-accounts/collective/CollectiveHostingControls';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import { DashboardCardGridSkeleton } from '@/components/ui/dashboard/DashboardSkeletons';
import { Button } from '@/components/ui/primitives/Button';
import { VenueSyncPill } from '@/components/linked-accounts/collective/CollectivePills';
import { CollectiveTodoStrip } from '@/components/linked-accounts/collective/CollectiveTodoStrip';
import { CollectiveServicesGrid } from '@/components/linked-accounts/collective/CollectiveServicesGrid';
import { buildCollectiveTodos } from '@/lib/linked-accounts/replicas/collective-todos';
import { hiddenPillVenue } from '@/lib/linked-accounts/replicas/status';
import { collectiveCopy } from '@/lib/linked-accounts/collective-copy';
import { currencySymbolFromCode } from '@/lib/money/currency-symbol';
import type { CollectiveCalendarGroup } from '@/lib/linked-accounts/replicas/host-calendars';
import type { CollectiveServiceBlock } from '@/lib/linked-accounts/replicas/service-blocks';
import type { BulkOp, BulkOpResult } from '@/lib/linked-accounts/replicas/bulk-ops';
import type { PreviewVenue } from '@/lib/linked-accounts/replicas/bulk-preview';

type AreaTab = 'services' | 'venues' | 'history';

interface CollectiveMemberRow {
  venueId: string;
  venueName: string;
  status: string;
  alsoRuns?: string | null;
}

interface CollectiveListEntry {
  id: string;
  hostVenueId: string;
  myVenueId: string;
  members: CollectiveMemberRow[];
  serviceModel?: string;
  pausedAt?: string | null;
  pendingHost?: { venueId: string; venueName: string; transferAt: string | null } | null;
}

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
  const [tab, setTab] = useState<AreaTab>('services');
  const [historyVenueId, setHistoryVenueId] = useState<string | null>(null);
  /** Every collective this venue is in, with its venues and invitations, from the collectives list. */
  const [collectiveList, setCollectiveList] = useState<CollectiveListEntry[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [res, collectivesRes] = await Promise.all([
        fetch('/api/venue/appointment-services'),
        fetch('/api/venue/collectives'),
      ]);
      if (collectivesRes.ok) {
        const list = (await collectivesRes.json()) as { collectives?: CollectiveListEntry[] };
        setCollectiveList(list.collectives ?? []);
      }
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

  /** This collective's entry in the collectives list: who is in it, and any move of hosting. */
  const entry = useMemo(
    () => collectiveList.find((c) => c.id === collective?.id) ?? null,
    [collectiveList, collective],
  );

  const venueRows = useMemo<CollectiveVenueRow[]>(() => {
    // The services say which collective this page is about; the list says who is in it.
    const match = entry;
    const hostVenueId = match?.hostVenueId ?? null;
    return (match?.members ?? [])
        .filter((m) => m.status === 'active' || m.status === 'invited')
        .map((m) => ({
          venue_id: m.venueId,
          venue_name: m.venueName,
          status: m.status as 'active' | 'invited',
          is_host: m.venueId === hostVenueId,
          also_runs: m.alsoRuns ?? null,
        }));
  }, [entry]);

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

      {entry?.pendingHost && entry.pendingHost.venueId === entry.myVenueId && !entry.pendingHost.transferAt ? (
        <HostingRequestBanner
          collectiveId={collective.id}
          collectiveName={collective.name}
          hostName={collective.hostVenueName}
          onChanged={() => void load()}
        />
      ) : null}
      {entry?.pausedAt ? (
        <PausedHostingBanner
          collectiveId={collective.id}
          collectiveName={collective.name}
          formerHostName={collective.hostVenueName}
          onChanged={() => void load()}
        />
      ) : null}

      <TabBar
        tabs={[
          { id: 'services' as const, label: collectiveCopy('ov.tab.overview') },
          // A member's own membership lives on its Linked accounts row, so it has no Venues tab.
          ...(collective.isHost ? [{ id: 'venues' as const, label: collectiveCopy('ov.tab.venues') }] : []),
          { id: 'history' as const, label: collectiveCopy('ov.tab.history') },
        ]}
        value={tab}
        onChange={(next) => {
          if (next !== 'history') setHistoryVenueId(null);
          setTab(next);
        }}
      />

      {tab === 'venues' && collective.isHost ? (
        <CollectiveVenuesPanel
          collectiveId={collective.id}
          collectiveName={collective.name}
          venues={venueRows}
          groups={groups}
          onChanged={() => void load()}
          serviceModel={entry?.serviceModel}
          pendingHost={entry?.pendingHost ?? null}
          onEnded={() => {
            window.location.href = '/dashboard';
          }}
          onShowHistory={(venueId) => {
            setHistoryVenueId(venueId);
            setTab('history');
          }}
        />
      ) : null}

      {tab === 'history' ? (
        <CollectiveHistoryPanel
          key={historyVenueId ?? 'all'}
          collectiveId={collective.id}
          collectiveName={collective.name}
          venues={collective.isHost ? venueRows.map((v) => ({ venue_id: v.venue_id, venue_name: v.venue_name })) : []}
          initialVenueId={historyVenueId}
        />
      ) : null}

      {tab === 'services' ? (
      <>

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
                    {collectiveCopy('ov.venue.countsWords', {
                      services: `${onPage} ${collectiveCopy(onPage === 1 ? 'ov.venue.service' : 'ov.venue.services')}`,
                      calendars: `${calendars} ${collectiveCopy(calendars === 1 ? 'ov.venue.calendar' : 'ov.venue.calendars')}`,
                    })}
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

      {!collective.isHost ? (
        <MemberServicesList services={services} hostName={collective.hostVenueName} collectiveName={collective.name} />
      ) : (
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
      )}
      </>
      ) : null}
    </div>
  );
}

/**
 * A member's view of the services tab (live review, 2026-09-17). The grid is the host's tool: it
 * needs every venue's calendars, which only the host reads. A member sees what is on the page for it
 * and what is parked, and chooses its calendars on its own Services page.
 */
function MemberServicesList({
  services,
  hostName,
  collectiveName,
}: {
  services: ServiceRow[];
  hostName: string;
  collectiveName: string;
}) {
  const onPage = services.filter((s) => s.collective?.role === 'replica');
  const parked = services.filter((s) => s.collective?.role === 'parked');
  const retired = services.filter((s) => s.collective?.role === 'retired');
  const section = (title: string, caption: string, rows: ServiceRow[], pill: (s: ServiceRow) => ReactNode) =>
    rows.length === 0 ? null : (
      <section className="space-y-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            {title} <span className="font-normal text-slate-500">({rows.length})</span>
          </h3>
          <p className="text-xs text-slate-600">{caption}</p>
        </div>
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {rows.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="text-slate-900">{s.name}</span>
              {pill(s)}
            </li>
          ))}
        </ul>
      </section>
    );
  return (
    <SectionCard elevated>
      <SectionCard.Body className="space-y-5">
        <p className="text-sm text-slate-600">
          Choose which of your calendars offer each service on your{' '}
          <a href="/dashboard/appointment-services" className="font-medium text-brand-700 underline underline-offset-2">
            Services
          </a>{' '}
          page.
        </p>
        {section(
          collectiveCopy('svc.member.section.fromHostTitle', { host: hostName }),
          collectiveCopy('svc.member.section.fromHostCaption', { host: hostName, collective: collectiveName }),
          onPage,
          (s) => {
            const block = s.collective!;
            const venue = block.status === 'hidden' ? hiddenPillVenue(block.hidden_reasons) : null;
            return (
              <VenueSyncPill
                status={block.status}
                reason={block.status_reason}
                label={venue ? collectiveCopy('svc.card.hiddenAt', { venue }) : null}
              />
            );
          },
        )}
        {section(
          collectiveCopy('svc.member.section.parkedTitle', { collective: collectiveName }),
          collectiveCopy('svc.member.section.parkedCaption', { collective: collectiveName, host: hostName }),
          parked,
          () => <span className="text-xs text-slate-500">{collectiveCopy('common.pill.parked')}</span>,
        )}
        {section(
          collectiveCopy('svc.member.section.retired', { host: hostName }),
          collectiveCopy('svc.member.section.retiredCaption', { host: hostName, collective: collectiveName }),
          retired,
          () => <span className="text-xs text-slate-500">{collectiveCopy('common.pill.retired')}</span>,
        )}
      </SectionCard.Body>
    </SectionCard>
  );
}
