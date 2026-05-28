'use client';

import { useEffect, useMemo, useState } from 'react';
import type {
  AppointmentCatalogAddonGroup,
  AddonGroup,
  Addon,
  ServiceAddonGroupLink,
} from '@/types/booking-models';
import { Button } from '@/components/ui/primitives/Button';
import { Dialog } from '@/components/ui/primitives/Dialog';
import {
  AddonGroupEditor,
  addonGroupValueFromCatalog,
  poundsInputToPence,
  type AddonGroupEditorValue,
} from './AddonGroupEditor';

export interface AddonGroupsSectionProps {
  /** Linked add-on groups for the service currently being edited. */
  links: AppointmentCatalogAddonGroup[];
  onChange: (next: AppointmentCatalogAddonGroup[]) => void;
  isAdmin: boolean;
  currencySymbol: string;
}

interface VenueAddonLibrary {
  groups: AddonGroup[];
  addons_by_group: Record<string, Addon[]>;
  service_links: ServiceAddonGroupLink[];
}

/**
 * The Add-Ons section in the Add/Edit Service form. Lists the linked add-on groups,
 * lets admins reorder, edit, unlink, create new groups inline, and pick from the
 * venue-wide library.
 */
export function AddonGroupsSection({
  links,
  onChange,
  isAdmin,
  currencySymbol,
}: AddonGroupsSectionProps) {
  const [library, setLibrary] = useState<VenueAddonLibrary | null>(null);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [creatingNew, setCreatingNew] = useState(false);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    fetch('/api/venue/addon-groups?include_inactive=true', { credentials: 'same-origin' })
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(((data as { error?: string }).error) ?? 'Failed to load add-ons');
        }
        return (await res.json()) as VenueAddonLibrary;
      })
      .then((data) => {
        if (!cancelled) setLibrary(data);
      })
      .catch((err) => {
        if (!cancelled) setLibraryError(err instanceof Error ? err.message : 'Failed to load add-ons');
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  const linkedIds = useMemo(() => new Set(links.map((l) => l.group.id)), [links]);
  const availableForPicker = useMemo(
    () => (library?.groups ?? []).filter((g) => !linkedIds.has(g.id) && g.is_active !== false),
    [library, linkedIds],
  );

  if (!isAdmin) {
    return null;
  }

  function moveLink(idx: number, dir: -1 | 1) {
    const target = idx + dir;
    if (target < 0 || target >= links.length) return;
    const next = links.slice();
    const tmp = next[idx]!;
    next[idx] = next[target]!;
    next[target] = tmp;
    onChange(next);
  }

  function unlink(idx: number) {
    onChange(links.filter((_, i) => i !== idx));
  }

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
    const data = (await res.json()) as { group: AddonGroup; addons: Addon[] };
    // Keep the full option set (incl. inactive) in form state so a later re-save
    // doesn't drop options that were merely deactivated. Display filters separately.
    const updatedCatalog: AppointmentCatalogAddonGroup = {
      group: data.group,
      addons: data.addons,
      link_sort_order: 0,
    };
    if (isNew) {
      onChange([...links, { ...updatedCatalog, link_sort_order: links.length }]);
    } else if (editingIdx != null) {
      const next = links.map((row, i) =>
        i === editingIdx ? { ...updatedCatalog, link_sort_order: row.link_sort_order } : row,
      );
      onChange(next);
    }
    // refresh library so the picker has fresh data
    fetch('/api/venue/addon-groups?include_inactive=true', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((lib) => setLibrary(lib))
      .catch(() => undefined);
  }

  function pickExisting(groupId: string) {
    const group = library?.groups.find((g) => g.id === groupId);
    const addons = library?.addons_by_group[groupId] ?? [];
    if (!group) return;
    const next: AppointmentCatalogAddonGroup = {
      group,
      addons,
      link_sort_order: links.length,
    };
    onChange([...links, next]);
    setPicking(false);
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-800">Add-ons</p>
          <p className="text-xs text-slate-500">
            Optional extras a client can add to this service at booking time. Each group lets you set rules
            (pick one, pick many, required, optional).
          </p>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <Button type="button" variant="secondary" onClick={() => setPicking(true)} className="flex-1 sm:flex-none">
            Use existing group
          </Button>
          <Button type="button" onClick={() => setCreatingNew(true)} className="flex-1 sm:flex-none">
            + Add group
          </Button>
        </div>
      </div>

      {libraryError ? <p className="mt-1 text-xs text-red-600">{libraryError}</p> : null}

      {links.length === 0 ? (
        <p className="rounded-lg bg-slate-50 px-3 py-4 text-center text-sm text-slate-500">
          No add-ons linked yet. Click &quot;Add group&quot; to offer extras for this service.
        </p>
      ) : (
        <ul className="space-y-2">
          {links.map((entry, idx) => {
            const { group } = entry;
            const visibleAddons = entry.addons.filter((a) => a.is_active && !a.archived_at);
            const ruleText =
              group.selection_type === 'single'
                ? group.min_select === 1
                  ? 'Pick exactly one (required)'
                  : 'Pick one (optional)'
                : `${group.min_select === 0 ? 'Pick any' : `Min ${group.min_select}`}${
                    group.max_select != null ? `, max ${group.max_select}` : ''
                  }`;
            return (
              <li key={group.id} className="rounded-lg border border-slate-200 p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900">{group.name}</p>
                    <p className="text-xs text-slate-500">
                      {ruleText} · {visibleAddons.length} {visibleAddons.length === 1 ? 'option' : 'options'}
                      {group.hidden_from_online ? ' · Hidden from online' : ''}
                    </p>
                    {visibleAddons.length > 0 ? (
                      <ul className="mt-2 space-y-0.5 text-xs text-slate-600">
                        {visibleAddons.map((a) => (
                          <li key={a.id} className="flex items-center justify-between gap-3">
                            <span className="truncate">{a.name}</span>
                            <span className="tabular-nums">
                              +{currencySymbol}
                              {(a.additional_price_pence / 100).toFixed(2)}
                              {a.additional_duration_minutes > 0
                                ? ` · +${a.additional_duration_minutes} min`
                                : ''}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => moveLink(idx, -1)}
                      disabled={idx === 0}
                      className="inline-flex h-9 w-9 items-center justify-center rounded text-slate-400 hover:bg-slate-100 disabled:opacity-30"
                      aria-label="Move up"
                      title="Move up"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => moveLink(idx, 1)}
                      disabled={idx === links.length - 1}
                      className="inline-flex h-9 w-9 items-center justify-center rounded text-slate-400 hover:bg-slate-100 disabled:opacity-30"
                      aria-label="Move down"
                      title="Move down"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingIdx(idx)}
                      className="rounded border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => unlink(idx)}
                      className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                    >
                      Unlink
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <AddonGroupEditor
        open={creatingNew}
        title="Add an add-on group"
        currencySymbol={currencySymbol}
        onClose={() => setCreatingNew(false)}
        onSubmit={async (value) => {
          await saveGroupEdit(value);
          setCreatingNew(false);
        }}
        saveLabel="Add group"
      />
      <AddonGroupEditor
        open={editingIdx != null}
        title="Edit add-on group"
        currencySymbol={currencySymbol}
        initialValue={editingIdx != null ? addonGroupValueFromCatalog(links[editingIdx]!) : undefined}
        onClose={() => setEditingIdx(null)}
        onSubmit={async (value) => {
          await saveGroupEdit(value);
          setEditingIdx(null);
        }}
        saveLabel="Save changes"
      />

      <Dialog
        open={picking}
        onOpenChange={(next) => {
          if (!next) setPicking(false);
        }}
        title="Pick an existing add-on group"
      >
        {availableForPicker.length === 0 ? (
          <p className="text-sm text-slate-500">No other add-on groups available. Create a new one instead.</p>
        ) : (
          <ul className="space-y-2">
            {availableForPicker.map((g) => (
              <li key={g.id}>
                <button
                  type="button"
                  onClick={() => pickExisting(g.id)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-left text-sm hover:bg-slate-50"
                >
                  <span className="font-medium text-slate-800">{g.name}</span>
                  <span className="ml-2 text-xs text-slate-500">
                    {g.selection_type === 'single' ? 'Pick one' : 'Pick multi'}
                    {g.hidden_from_online ? ' · Hidden online' : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Dialog>
    </div>
  );
}
