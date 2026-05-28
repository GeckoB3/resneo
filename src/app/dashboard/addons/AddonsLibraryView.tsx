'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type {
  Addon,
  AddonGroup,
  AppointmentService,
  ServiceAddonGroupLink,
} from '@/types/booking-models';
import { PageHeader } from '@/components/ui/dashboard/PageHeader';
import { EmptyState } from '@/components/ui/dashboard/EmptyState';
import { Pill } from '@/components/ui/dashboard/Pill';
import { DashboardCardGridSkeleton } from '@/components/ui/dashboard/DashboardSkeletons';
import {
  AddonGroupEditor,
  addonGroupValueFromRecords,
  emptyAddonGroupValue,
  poundsInputToPence,
  type AddonGroupEditorValue,
} from '@/components/dashboard/appointment-services/AddonGroupEditor';

/** Shape returned by `GET /api/venue/addon-groups`. */
interface LibraryPayload {
  groups: AddonGroup[];
  addons_by_group: Record<string, Addon[]>;
  service_links: ServiceAddonGroupLink[];
}

/** Service rows returned by `GET /api/venue/appointment-services`. */
interface ServiceRow {
  id: string;
  name: string;
}

function selectionRuleLabel(group: AddonGroup): string {
  if (group.selection_type === 'single') {
    return group.min_select === 1 ? 'Pick exactly one (required)' : 'Pick one (optional)';
  }
  const max = group.max_select == null ? '' : `, max ${group.max_select}`;
  const min = group.min_select === 0 ? 'Pick any' : `Min ${group.min_select}`;
  return `${min}${max}`;
}

export function AddonsLibraryView({
  isAdmin,
  currencySymbol,
  /**
   * When true, suppress the page-level `<PageHeader>` so this component can render
   * as the body of a tab inside another page (e.g. /dashboard/appointment-services).
   */
  embedded = false,
}: {
  isAdmin: boolean;
  currencySymbol: string;
  embedded?: boolean;
}) {
  const [library, setLibrary] = useState<LibraryPayload | null>(null);
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [creatingNew, setCreatingNew] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);
  const [busyDeleteId, setBusyDeleteId] = useState<string | null>(null);
  const [includeInactive, setIncludeInactive] = useState(true);

  const loadLibrary = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [libRes, svcRes] = await Promise.all([
        fetch(`/api/venue/addon-groups?include_inactive=${includeInactive ? 'true' : 'false'}`, {
          credentials: 'same-origin',
        }),
        fetch('/api/venue/appointment-services', { credentials: 'same-origin' }),
      ]);
      if (!libRes.ok) {
        const data = await libRes.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? 'Failed to load add-ons');
      }
      if (!svcRes.ok) {
        const data = await svcRes.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? 'Failed to load services');
      }
      const libPayload = (await libRes.json()) as LibraryPayload;
      const svcPayload = (await svcRes.json()) as { services?: AppointmentService[] };
      const svcRows = (svcPayload.services ?? []).map((s) => ({ id: s.id, name: s.name }));
      setLibrary(libPayload);
      setServices(svcRows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load add-ons');
    } finally {
      setLoading(false);
    }
  }, [includeInactive]);

  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  const groups = library?.groups ?? [];
  const addonsByGroup = library?.addons_by_group ?? {};
  const links = useMemo<ServiceAddonGroupLink[]>(
    () => library?.service_links ?? [],
    [library],
  );

  const serviceIdToName = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of services) map.set(s.id, s.name);
    return map;
  }, [services]);

  const usedByForGroup = useCallback(
    (groupId: string) => {
      const serviceIds: string[] = [];
      for (const link of links) {
        if (link.addon_group_id !== groupId) continue;
        const sid = link.service_item_id ?? link.appointment_service_id;
        if (sid) serviceIds.push(sid);
      }
      return serviceIds
        .map((id) => ({ id, name: serviceIdToName.get(id) ?? 'Unknown service' }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    [links, serviceIdToName],
  );

  async function saveGroupEdit(value: AddonGroupEditorValue) {
    const isNew = !value.id;
    const url = isNew ? '/api/venue/addon-groups' : `/api/venue/addon-groups/${value.id}`;
    const method = isNew ? 'POST' : 'PATCH';
    const body = JSON.stringify({
      group: {
        ...(value.id ? { id: value.id } : {}),
        name: value.name,
        prompt_to_client: value.prompt_to_client || null,
        description: value.description || null,
        selection_type: value.selection_type,
        min_select: value.min_select,
        max_select: value.max_select,
        hidden_from_online: value.hidden_from_online,
        is_active: value.is_active,
        sort_order: value.sort_order,
        addons: value.addons.map((a, idx) => ({
          ...(a.id ? { id: a.id } : {}),
          name: a.name,
          description: a.description || null,
          additional_price_pence: poundsInputToPence(a.price),
          additional_duration_minutes: a.additional_duration_minutes,
          is_active: a.is_active,
          sort_order: a.sort_order ?? idx,
        })),
      },
    });
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error ?? 'Failed to save group');
    }
    await loadLibrary();
  }

  async function deleteOrArchive(groupId: string) {
    if (busyDeleteId) return;
    const group = groups.find((g) => g.id === groupId);
    const confirmMsg = group?.is_active
      ? 'Delete this add-on group? If any past bookings used it, it will be archived (deactivated) instead.'
      : 'This group is already inactive. Delete it permanently? (Only allowed if no bookings reference it.)';
    if (!window.confirm(confirmMsg)) return;
    setBusyDeleteId(groupId);
    try {
      const res = await fetch(`/api/venue/addon-groups/${groupId}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? 'Failed to delete group');
      }
      await loadLibrary();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete group');
    } finally {
      setBusyDeleteId(null);
    }
  }

  const editingGroup = editingGroupId ? groups.find((g) => g.id === editingGroupId) : null;
  const editingValue: AddonGroupEditorValue | undefined = editingGroup
    ? addonGroupValueFromRecords(editingGroup, addonsByGroup[editingGroup.id] ?? [])
    : undefined;

  return (
    <div>
      {embedded ? (
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Add-on library</h2>
            <p className="text-xs text-slate-500">
              {isAdmin
                ? 'Reusable groups of optional extras (price + time) you can link to any appointment service.'
                : 'Add-on groups configured by your venue admin.'}
            </p>
          </div>
          {isAdmin ? (
            <button
              type="button"
              onClick={() => setCreatingNew(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path d="M12 5v14m-7-7h14" />
              </svg>
              New add-on group
            </button>
          ) : null}
        </div>
      ) : (
        <PageHeader
          eyebrow="Catalogue"
          title="Add-ons"
          subtitle={
            isAdmin
              ? 'Reusable groups of optional extras (price + time) you can link to any appointment service.'
              : 'Add-on groups configured by your venue admin.'
          }
          actions={
            isAdmin ? (
              <button
                type="button"
                onClick={() => setCreatingNew(true)}
                className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-700"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path d="M12 5v14m-7-7h14" />
                </svg>
                New add-on group
              </button>
            ) : null
          }
        />
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <label className="inline-flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => setIncludeInactive(e.target.checked)}
          />
          Show archived groups
        </label>
        <p className="text-xs text-slate-500">
          Groups are venue-wide. Linking them to a service is done from the service edit form.
        </p>
      </div>

      {error ? (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} className="text-red-400 hover:text-red-600">
            ×
          </button>
        </div>
      ) : null}

      {loading ? (
        <DashboardCardGridSkeleton cards={3} />
      ) : groups.length === 0 ? (
        <EmptyState
          title="No add-on groups yet"
          description="Build a reusable group of optional extras — a single conditioner choice, a multi-select set of finishing touches, or a hidden staff-only add-on."
          action={
            isAdmin ? (
              <button
                type="button"
                onClick={() => setCreatingNew(true)}
                className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-700"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path d="M12 5v14m-7-7h14" />
                </svg>
                Create your first add-on group
              </button>
            ) : null
          }
        />
      ) : (
        <ul className="space-y-3">
          {groups.map((group) => {
            const options = addonsByGroup[group.id] ?? [];
            const usedBy = usedByForGroup(group.id);
            const isExpanded = expandedGroupId === group.id;
            const archived = !group.is_active;
            return (
              <li
                key={group.id}
                className={`rounded-2xl border bg-white shadow-sm ${
                  archived ? 'border-slate-200/80 opacity-75' : 'border-slate-200'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-4 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-semibold text-slate-900">{group.name}</h2>
                      <Pill variant={group.selection_type === 'single' ? 'brand' : 'info'} size="sm">
                        {group.selection_type === 'single' ? 'Single-select' : 'Multi-select'}
                      </Pill>
                      {archived ? (
                        <Pill variant="warning" size="sm" dot>
                          Archived
                        </Pill>
                      ) : (
                        <Pill variant="success" size="sm" dot>
                          Active
                        </Pill>
                      )}
                      {group.hidden_from_online ? (
                        <Pill variant="neutral" size="sm">
                          Hidden online
                        </Pill>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {selectionRuleLabel(group)} · {options.length}{' '}
                      {options.length === 1 ? 'option' : 'options'}
                    </p>
                    {group.prompt_to_client?.trim() ? (
                      <p className="mt-1 text-xs italic text-slate-500">
                        Prompt: &ldquo;{group.prompt_to_client.trim()}&rdquo;
                      </p>
                    ) : null}

                    {usedBy.length > 0 ? (
                      <div className="mt-3">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                          Used by ({usedBy.length})
                        </p>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {usedBy.map((svc) => (
                            <Link
                              key={svc.id}
                              href={`/dashboard/appointment-services?tab=services&service=${svc.id}`}
                              className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-700 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
                            >
                              {svc.name}
                            </Link>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <p className="mt-3 text-[11px] text-slate-400">Not linked to any services yet.</p>
                    )}
                  </div>
                  <div className="flex flex-col items-stretch gap-1.5 sm:flex-row sm:items-center">
                    <button
                      type="button"
                      onClick={() => setExpandedGroupId(isExpanded ? null : group.id)}
                      className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      aria-expanded={isExpanded}
                    >
                      {isExpanded ? 'Hide options' : `Show ${options.length} option${options.length === 1 ? '' : 's'}`}
                    </button>
                    {isAdmin ? (
                      <>
                        <button
                          type="button"
                          onClick={() => setEditingGroupId(group.id)}
                          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteOrArchive(group.id)}
                          disabled={busyDeleteId === group.id}
                          className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                          title="Deletes the group, or archives it automatically if past bookings reference it"
                        >
                          {busyDeleteId === group.id ? '…' : 'Delete'}
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>

                {isExpanded ? (
                  <div className="border-t border-slate-100 bg-slate-50/50 p-4">
                    {options.length === 0 ? (
                      <p className="text-xs text-slate-500">No options in this group.</p>
                    ) : (
                      <ul className="space-y-2">
                        {options.map((a) => (
                          <li
                            key={a.id}
                            className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-white px-3 py-2 text-sm ${
                              a.is_active && !a.archived_at ? 'border-slate-200' : 'border-slate-200/60 opacity-60'
                            }`}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-medium text-slate-900">{a.name}</span>
                                {!a.is_active ? (
                                  <Pill variant="warning" size="sm">
                                    Inactive
                                  </Pill>
                                ) : null}
                                {a.archived_at ? (
                                  <Pill variant="neutral" size="sm">
                                    Archived
                                  </Pill>
                                ) : null}
                              </div>
                              {a.description ? (
                                <p className="mt-0.5 text-xs text-slate-500">{a.description}</p>
                              ) : null}
                            </div>
                            <div className="shrink-0 text-right tabular-nums">
                              <p className="text-sm font-semibold text-slate-800">
                                +{currencySymbol}
                                {(a.additional_price_pence / 100).toFixed(2)}
                              </p>
                              {a.additional_duration_minutes > 0 ? (
                                <p className="text-[11px] text-slate-500">+{a.additional_duration_minutes} min</p>
                              ) : null}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <AddonGroupEditor
        open={creatingNew}
        title="New add-on group"
        currencySymbol={currencySymbol}
        initialValue={emptyAddonGroupValue()}
        onClose={() => setCreatingNew(false)}
        onSubmit={async (value) => {
          await saveGroupEdit(value);
          setCreatingNew(false);
        }}
        saveLabel="Create group"
      />

      <AddonGroupEditor
        open={editingGroupId != null}
        title="Edit add-on group"
        currencySymbol={currencySymbol}
        initialValue={editingValue}
        onClose={() => setEditingGroupId(null)}
        onSubmit={async (value) => {
          await saveGroupEdit(value);
          setEditingGroupId(null);
        }}
        saveLabel="Save changes"
      />
    </div>
  );
}
