'use client';

/**
 * The collective's services as a matrix (UX spec §2 item 15; plan Appendix E contract 13; W5).
 *
 * Services down, venues across. The host's real questions are column questions ("is Riverside
 * carrying everything?", "which services has nobody picked up?"), and divergence between venues is
 * the defect this whole project exists to remove: a matrix renders divergence directly, where a
 * list hides it behind forty rows.
 *
 * Changes stage rather than apply, so the confirmation can say exactly what will change and where,
 * and so one save can carry hundreds of them. A cell that the engine refuses stays staged and stays
 * selected, which is what makes Retry re-send only the failures.
 */
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/primitives/Button';
import { Dialog } from '@/components/ui/primitives/Dialog';
import { CollectiveCalendarsSection, type CollectiveCalendarsValue } from './CollectiveCalendarsSection';
import { collectiveCopy, formatVenueList } from '@/lib/linked-accounts/collective-copy';
import { PREVIEW_REASON_WORDS, type PreviewVenue } from '@/lib/linked-accounts/replicas/bulk-preview';
import type { CollectiveCalendarGroup } from '@/lib/linked-accounts/replicas/host-calendars';
import type { CollectiveServiceBlock } from '@/lib/linked-accounts/replicas/service-blocks';
import type { BulkOp, BulkOpResult } from '@/lib/linked-accounts/replicas/bulk-ops';

export interface GridService {
  id: string;
  name: string;
  collective: CollectiveServiceBlock | null;
}

export type GridFilter = 'all' | 'attention' | 'off_page';

export interface CollectiveServicesGridProps {
  services: GridService[];
  groups: CollectiveCalendarGroup[];
  currencySymbol?: string;
  /** Sends one chunk of at most 200 operations and returns the per-operation answers. */
  onCommit: (ops: BulkOp[]) => Promise<BulkOpResult[]>;
  /** Called after a save so the page can reload what the collective now looks like. */
  onSaved?: () => void;
  /** What each venue's guests would see if the staged changes were saved (contract 13 preview). */
  onPreview?: (ops: BulkOp[]) => Promise<PreviewVenue[]>;
}

/** A staged change, keyed so the same cell cannot hold two contradictory ones. */
type Staged = BulkOp & { key: string };

const keyOf = (op: BulkOp): string =>
  op.op === 'assign' || op.op === 'unassign'
    ? `calendar:${op.service_id}:${op.venue_id}:${op.calendar_id}`
    : `${op.op}:${op.service_id}`;

/** How much of a venue offers a service: all its calendars, some, or none. */
export function cellState(group: CollectiveCalendarGroup, itemId: string | null): 'all' | 'some' | 'none' {
  if (!itemId) return 'none';
  const active = group.calendars.filter((c) => c.is_active);
  if (active.length === 0) return 'none';
  const offering = active.filter((c) => c.assigned.some((a) => a.item_id === itemId)).length;
  if (offering === 0) return 'none';
  return offering === active.length ? 'all' : 'some';
}

const CELL_LABEL: Record<'all' | 'some' | 'none', string> = {
  all: collectiveCopy('ov.grid.cell.all'),
  some: collectiveCopy('ov.grid.cell.some'),
  none: collectiveCopy('ov.grid.cell.none'),
};

export function CollectiveServicesGrid({
  services,
  groups,
  currencySymbol = '£',
  onCommit,
  onSaved,
  onPreview,
}: CollectiveServicesGridProps) {
  const [filter, setFilter] = useState<GridFilter>('all');
  const [search, setSearch] = useState('');
  const [selectedServices, setSelectedServices] = useState<Set<string>>(new Set());
  const [selectedVenues, setSelectedVenues] = useState<Set<string>>(new Set());
  const [staged, setStaged] = useState<Staged[]>([]);
  const [openCell, setOpenCell] = useState<{ serviceId: string; venueId: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [failures, setFailures] = useState<{ key: string; message: string }[]>([]);
  /** The ask before a save: it says how many services at which venues, and nothing goes until yes. */
  const [confirming, setConfirming] = useState(false);
  const [preview, setPreview] = useState<{ state: 'loading' | 'ready' | 'failed'; venues: PreviewVenue[] } | null>(
    null,
  );

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return services.filter((service) => {
      if (term && !service.name.toLowerCase().includes(term)) return false;
      const block = service.collective;
      const onPage = Boolean(block) && block!.role === 'master';
      if (filter === 'off_page') return !onPage;
      if (filter === 'all') return true;
      // Attention: anything a guest cannot book everywhere, or that no calendar offers.
      if (!onPage) return false;
      const itemId = block!.item_id;
      const noCalendars = groups.every((g) => cellState(g, itemId) === 'none');
      return noCalendars || block!.status === 'failed' || block!.status === 'hidden';
    });
  }, [services, search, filter, groups]);

  const stagedFor = (serviceId: string, venueId: string) =>
    staged.filter(
      (s) =>
        s.service_id === serviceId &&
        ((s.op === 'assign' || s.op === 'unassign') ? s.venue_id === venueId : true),
    );

  const stage = (ops: BulkOp[]) => {
    setStaged((prev) => {
      const next = new Map(prev.map((s) => [s.key, s]));
      for (const op of ops) {
        const key = keyOf(op);
        const existing = next.get(key);
        // Staging the opposite of what is already staged means the host changed their mind.
        if (existing && opposites(existing, op)) next.delete(key);
        else next.set(key, { ...op, key });
      }
      return [...next.values()];
    });
  };

  const replaceCellCalendars = (serviceId: string, venueId: string, value: CollectiveCalendarsValue) => {
    setStaged((prev) => {
      const others = prev.filter(
        (s) => !((s.op === 'assign' || s.op === 'unassign') && s.service_id === serviceId && s.venue_id === venueId),
      );
      const ops: BulkOp[] = [
        ...value.add.map((ref) => ({
          op: 'assign' as const,
          service_id: serviceId,
          venue_id: ref.venue_id,
          calendar_id: ref.calendar_id,
        })),
        ...value.remove.map((ref) => ({
          op: 'unassign' as const,
          service_id: serviceId,
          venue_id: ref.venue_id,
          calendar_id: ref.calendar_id,
        })),
      ];
      return [...others, ...ops.map((op) => ({ ...op, key: keyOf(op) }))];
    });
  };

  const crossing = (): { serviceIds: string[]; venueIds: string[] } => ({
    serviceIds: selectedServices.size > 0 ? [...selectedServices] : rows.map((r) => r.id),
    venueIds: selectedVenues.size > 0 ? [...selectedVenues] : groups.map((g) => g.venue_id),
  });

  const bulk = (op: 'offer' | 'withdraw' | 'assign' | 'unassign' | 'retry') => {
    const { serviceIds, venueIds } = crossing();
    const ops: BulkOp[] = [];
    for (const serviceId of serviceIds) {
      const service = services.find((s) => s.id === serviceId);
      if (!service) continue;
      if (op === 'offer' || op === 'withdraw') {
        ops.push({ op, service_id: serviceId });
        continue;
      }
      if (op === 'retry') {
        for (const venueId of venueIds) ops.push({ op: 'retry', service_id: serviceId, venue_id: venueId });
        continue;
      }
      for (const venueId of venueIds) {
        const group = groups.find((g) => g.venue_id === venueId);
        if (!group) continue;
        for (const calendar of group.calendars.filter((c) => c.is_active)) {
          ops.push({ op, service_id: serviceId, venue_id: venueId, calendar_id: calendar.id });
        }
      }
    }
    stage(ops);
  };

  const stagedOps = (): BulkOp[] => staged.map(({ key: _key, ...op }) => op as BulkOp);

  /** "This changes {count} services at {venueList}": counted from what is staged, not selected. */
  const confirmSummary = () => {
    const serviceIds = new Set(staged.map((s) => s.service_id));
    const venueIds = new Set(
      staged.flatMap((s) =>
        s.op === 'assign' || s.op === 'unassign' || (s.op === 'retry' && s.venue_id)
          ? [s.venue_id as string]
          : groups.map((g) => g.venue_id),
      ),
    );
    const names = groups.filter((g) => venueIds.has(g.venue_id)).map((g) => g.venue_name);
    return collectiveCopy(serviceIds.size === 1 ? 'ov.bulk.confirm.messageOne' : 'ov.bulk.confirm.message', {
      count: serviceIds.size,
      venueList: formatVenueList(names),
    });
  };

  const openPreview = async () => {
    if (!onPreview) return;
    setPreview({ state: 'loading', venues: [] });
    try {
      setPreview({ state: 'ready', venues: await onPreview(stagedOps()) });
    } catch {
      setPreview({ state: 'failed', venues: [] });
    }
  };

  const save = async () => {
    if (staged.length === 0) return;
    setSaving(true);
    setFailures([]);
    try {
      const remaining: Staged[] = [];
      const failed: { key: string; message: string }[] = [];
      // 200 at a time, which is the route's limit and the client's progress unit.
      for (let start = 0; start < staged.length; start += 200) {
        const chunk = staged.slice(start, start + 200);
        const results = await onCommit(chunk.map(({ key: _key, ...op }) => op as BulkOp));
        results.forEach((result) => {
          if (result.ok) return;
          const op = chunk[result.index];
          if (!op) return;
          remaining.push(op);
          failed.push({ key: op.key, message: result.message ?? 'That change did not go through.' });
        });
      }
      // What failed stays staged and stays selected, so Save again re-sends only those.
      setStaged(remaining);
      setFailures(failed);
      onSaved?.();
    } finally {
      setSaving(false);
    }
  };

  const openGroup = openCell ? groups.find((g) => g.venue_id === openCell.venueId) ?? null : null;
  const openService = openCell ? services.find((s) => s.id === openCell.serviceId) ?? null : null;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-slate-200 bg-white p-0.5 text-sm">
          {(
            [
              ['all', collectiveCopy('ov.filter.all')],
              ['attention', collectiveCopy('ov.filter.attention')],
              ['off_page', collectiveCopy('ov.filter.offPage')],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              aria-pressed={filter === value}
              className={`rounded-md px-2.5 py-1 ${filter === value ? 'bg-brand-600 text-white' : 'text-slate-700'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <span className="sr-only">{collectiveCopy('ov.grid.search')}</span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={collectiveCopy('ov.grid.search')}
            className="rounded-lg border border-slate-200 px-2 py-1 text-sm"
          />
        </label>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr>
              <th scope="col" className="w-64 border-b border-slate-200 px-2 py-2 text-left font-medium text-slate-600">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={rows.length > 0 && rows.every((r) => selectedServices.has(r.id))}
                    onChange={(e) =>
                      setSelectedServices((prev) => {
                        const next = new Set(prev);
                        for (const row of rows) {
                          if (e.target.checked) next.add(row.id);
                          else next.delete(row.id);
                        }
                        return next;
                      })
                    }
                    aria-label="Select every service shown"
                    className="h-4 w-4 rounded border-slate-300 text-brand-600"
                  />
                  <span>Service</span>
                </label>
              </th>
              {groups.map((group) => (
                <th key={group.venue_id} scope="col" className="border-b border-slate-200 px-2 py-2 text-left font-medium text-slate-600">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selectedVenues.has(group.venue_id)}
                      onChange={(e) =>
                        setSelectedVenues((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(group.venue_id);
                          else next.delete(group.venue_id);
                          return next;
                        })
                      }
                      aria-label={`Select ${group.venue_name}`}
                      className="h-4 w-4 rounded border-slate-300 text-brand-600"
                    />
                    <span>{group.is_host ? collectiveCopy('svc.cal.venueYou', { venue: group.venue_name }) : group.venue_name}</span>
                  </label>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((service) => {
              const itemId = service.collective?.item_id ?? null;
              const onPage = service.collective?.role === 'master';
              return (
                <tr key={service.id}>
                  <th scope="row" className="border-b border-slate-100 px-2 py-2 text-left font-normal">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selectedServices.has(service.id)}
                        onChange={(e) =>
                          setSelectedServices((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(service.id);
                            else next.delete(service.id);
                            return next;
                          })
                        }
                        aria-label={`Select ${service.name}`}
                        className="h-4 w-4 rounded border-slate-300 text-brand-600"
                      />
                      <span className="text-slate-900">{service.name}</span>
                      {!onPage ? <span className="text-xs text-slate-500">({collectiveCopy('common.pill.parked')})</span> : null}
                    </label>
                  </th>
                  {groups.map((group) => {
                    const state = cellState(group, itemId);
                    const changes = stagedFor(service.id, group.venue_id).length;
                    const failedHere = failures.some((f) => f.key.includes(`${service.id}:${group.venue_id}`));
                    return (
                      <td key={group.venue_id} className="border-b border-slate-100 px-2 py-1.5">
                        <button
                          type="button"
                          onClick={() => setOpenCell({ serviceId: service.id, venueId: group.venue_id })}
                          disabled={!onPage}
                          className={`w-full rounded-lg border px-2 py-1 text-left text-xs disabled:cursor-not-allowed disabled:opacity-50 ${
                            failedHere
                              ? 'border-rose-300 bg-rose-50 text-rose-800'
                              : changes > 0
                                ? 'border-brand-300 bg-brand-50 text-brand-800'
                                : state === 'all'
                                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                                  : state === 'some'
                                    ? 'border-amber-200 bg-amber-50 text-amber-900'
                                    : 'border-slate-200 bg-white text-slate-600'
                          }`}
                          aria-label={`${service.name} at ${group.venue_name}: ${CELL_LABEL[state]}`}
                        >
                          {CELL_LABEL[state]}
                          {changes > 0 ? ` (${collectiveCopy('ov.grid.cell.staged', { count: changes })})` : ''}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {rows.length === 0 ? <p className="text-sm text-slate-500">{collectiveCopy('ov.grid.empty')}</p> : null}

      {selectedServices.size > 0 || selectedVenues.size > 0 || staged.length > 0 ? (
        <div className="sticky bottom-2 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-lg">
          <span className="text-sm text-slate-700">
            {collectiveCopy('ov.bulk.selected', {
              services: selectedServices.size || rows.length,
              venues: selectedVenues.size || groups.length,
            })}
          </span>
          <Button type="button" variant="secondary" size="sm" onClick={() => bulk('offer')}>
            {collectiveCopy('ov.bulk.offer')}
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={() => bulk('withdraw')}>
            {collectiveCopy('ov.bulk.withdraw')}
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={() => bulk('assign')}>
            {collectiveCopy('ov.bulk.addCalendars')}
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={() => bulk('unassign')}>
            {collectiveCopy('ov.bulk.removeCalendars')}
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={() => bulk('retry')}>
            {collectiveCopy('ov.bulk.retry')}
          </Button>
          <span className="ml-auto flex items-center gap-2">
            {staged.length > 0 ? (
              <>
                <Button type="button" variant="ghost" size="sm" onClick={() => setStaged([])} disabled={saving}>
                  {collectiveCopy('ov.bulk.discard')}
                </Button>
                {onPreview ? (
                  <Button type="button" variant="secondary" size="sm" onClick={() => void openPreview()} disabled={saving}>
                    {collectiveCopy('ov.preview.button')}
                  </Button>
                ) : null}
                <Button type="button" size="sm" onClick={() => setConfirming(true)} loading={saving}>
                  {collectiveCopy(staged.length === 1 ? 'ov.bulk.saveOne' : 'ov.bulk.save', { count: staged.length })}
                </Button>
              </>
            ) : null}
          </span>
        </div>
      ) : null}

      {failures.length > 0 ? (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          <p>
            {collectiveCopy(failures.length === 1 ? 'ov.bulk.someFailedOne' : 'ov.bulk.someFailed', {
              count: failures.length,
            })}
          </p>
        </div>
      ) : null}

      {confirming ? (
        <Dialog
          open
          onOpenChange={(next) => {
            if (!next) setConfirming(false);
          }}
          title={collectiveCopy('ov.bulk.confirm.title')}
          description={confirmSummary()}
          size="sm"
          footer={
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={() => {
                  setConfirming(false);
                  void save();
                }}
              >
                {collectiveCopy('ov.bulk.confirm.confirm')}
              </Button>
              {onPreview ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setConfirming(false);
                    void openPreview();
                  }}
                >
                  {collectiveCopy('ov.preview.button')}
                </Button>
              ) : null}
              <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
                Go back
              </Button>
            </div>
          }
        >
          <p className="sr-only">{confirmSummary()}</p>
        </Dialog>
      ) : null}

      {preview ? (
        <Dialog
          open
          onOpenChange={(next) => {
            if (!next) setPreview(null);
          }}
          title={collectiveCopy('ov.preview.title')}
          size="md"
          footer={
            <Button type="button" onClick={() => setPreview(null)}>
              {collectiveCopy('ov.grid.done')}
            </Button>
          }
        >
          {preview.state === 'loading' ? (
            <p role="status" className="text-sm text-slate-600">
              {collectiveCopy('ov.preview.loading')}
            </p>
          ) : preview.state === 'failed' ? (
            <p role="alert" className="text-sm text-rose-700">
              {collectiveCopy('ov.preview.failed')}
            </p>
          ) : (
            <div className="space-y-4">
              {preview.venues.map((venue) => (
                <section key={venue.venue_id} className="space-y-1">
                  <h3 className="text-sm font-semibold text-slate-900">
                    {venue.is_host ? collectiveCopy('svc.cal.venueYou', { venue: venue.venue_name }) : venue.venue_name}
                  </h3>
                  <p className="text-sm text-slate-700">
                    {venue.shows.length > 0
                      ? collectiveCopy('ov.preview.shows', { services: venue.shows.map((s) => s.name).join(', ') })
                      : collectiveCopy('ov.preview.nothing', { venue: venue.venue_name })}
                  </p>
                  {venue.hides.length > 0 ? (
                    <ul className="space-y-0.5 text-sm text-amber-900">
                      {venue.hides.map((hidden) => (
                        <li key={hidden.service_id}>
                          <span className="font-medium">{hidden.name}:</span>{' '}
                          {collectiveCopy('ov.preview.willHide', {
                            venue: venue.venue_name,
                            reason: PREVIEW_REASON_WORDS[hidden.reason],
                          })}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </section>
              ))}
            </div>
          )}
        </Dialog>
      ) : null}

      {openCell && openGroup && openService ? (
        <Dialog
          open
          onOpenChange={(next) => {
            if (!next) setOpenCell(null);
          }}
          title={`${openService.name} at ${openGroup.venue_name}`}
          size="md"
          footer={
            <Button type="button" onClick={() => setOpenCell(null)}>
              {collectiveCopy('ov.grid.done')}
            </Button>
          }
        >
          <CollectiveCalendarsSection
            groups={groups}
            scope={openGroup.venue_id}
            itemId={openService.collective?.item_id ?? null}
            collectiveName={openService.collective?.collective_name ?? ''}
            currencySymbol={currencySymbol}
            hiddenReasons={openService.collective?.hidden_reasons ?? []}
            value={valueFromStaged(staged, openService.id, openGroup.venue_id)}
            onChange={(next) => replaceCellCalendars(openService.id, openGroup.venue_id, next)}
          />
        </Dialog>
      ) : null}
    </section>
  );
}

/** Two staged operations cancel out when one undoes the other. */
function opposites(a: BulkOp, b: BulkOp): boolean {
  if (a.op === 'assign' && b.op === 'unassign') return true;
  if (a.op === 'unassign' && b.op === 'assign') return true;
  if (a.op === 'offer' && b.op === 'withdraw') return true;
  if (a.op === 'withdraw' && b.op === 'offer') return true;
  return false;
}

/** The staged calendar changes for one cell, in the shape the calendars section speaks. */
function valueFromStaged(staged: Staged[], serviceId: string, venueId: string): CollectiveCalendarsValue {
  const mine = staged.filter(
    (s) => s.service_id === serviceId && (s.op === 'assign' || s.op === 'unassign') && s.venue_id === venueId,
  );
  return {
    add: mine.filter((s) => s.op === 'assign').map((s) => ({ calendar_id: s.calendar_id!, venue_id: venueId })),
    remove: mine.filter((s) => s.op === 'unassign').map((s) => ({ calendar_id: s.calendar_id!, venue_id: venueId })),
  };
}

