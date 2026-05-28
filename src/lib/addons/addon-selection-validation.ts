import type { Addon, AddonGroup, BookingAddonSelectionInput } from '@/types/booking-models';

export interface AddonGroupForValidation {
  group: AddonGroup;
  addons: Addon[];
}

export interface ValidateSelectionResult {
  ok: boolean;
  errors: string[];
  /** Canonical-ordered list of chosen addons (group sort, then addon sort). */
  resolvedAddons: Addon[];
}

/**
 * Enforce min/max selection rules and ensure every chosen addon belongs to a group
 * currently linked to the service. Hidden-from-online groups are accepted on the
 * staff path (`source = 'staff'`) and rejected on the public path.
 */
export function validateAddonSelections(params: {
  selections: BookingAddonSelectionInput[];
  groupsForService: AddonGroupForValidation[];
  source: 'public' | 'staff';
}): ValidateSelectionResult {
  const { selections, groupsForService, source } = params;
  const errors: string[] = [];

  const visibleGroups = groupsForService.filter((g) => {
    if (!g.group.is_active) return false;
    if (source === 'public' && g.group.hidden_from_online) return false;
    return true;
  });

  const visibleAddonsById = new Map<string, { addon: Addon; group: AddonGroup }>();
  for (const g of visibleGroups) {
    for (const a of g.addons) {
      if (!a.is_active || a.archived_at) continue;
      visibleAddonsById.set(a.id, { addon: a, group: g.group });
    }
  }

  // Map of group id => chosen addons (deduped)
  const groupChoices = new Map<string, Addon[]>();
  const seen = new Set<string>();

  for (const sel of selections) {
    if (seen.has(sel.addon_id)) {
      errors.push(`Duplicate add-on selection: ${sel.addon_id}`);
      continue;
    }
    seen.add(sel.addon_id);
    const found = visibleAddonsById.get(sel.addon_id);
    if (!found) {
      errors.push(`Unknown or unavailable add-on: ${sel.addon_id}`);
      continue;
    }
    const list = groupChoices.get(found.group.id) ?? [];
    list.push(found.addon);
    groupChoices.set(found.group.id, list);
  }

  for (const g of visibleGroups) {
    const chosen = groupChoices.get(g.group.id) ?? [];
    const count = chosen.length;

    if (g.group.selection_type === 'single' && count > 1) {
      errors.push(`"${g.group.name}" allows only one selection.`);
    }
    if (count < g.group.min_select) {
      errors.push(
        g.group.min_select === 1
          ? `Choose an option for "${g.group.name}".`
          : `Choose at least ${g.group.min_select} options for "${g.group.name}".`,
      );
    }
    if (g.group.max_select != null && count > g.group.max_select) {
      errors.push(`"${g.group.name}" allows at most ${g.group.max_select} options.`);
    }
  }

  const groupSortLookup = new Map<string, number>();
  for (const g of visibleGroups) groupSortLookup.set(g.group.id, g.group.sort_order);

  const resolvedAddons: Addon[] = [];
  for (const sel of selections) {
    const f = visibleAddonsById.get(sel.addon_id);
    if (!f) continue;
    resolvedAddons.push(f.addon);
  }
  resolvedAddons.sort((a, b) => {
    const ga = groupSortLookup.get(a.addon_group_id) ?? 0;
    const gb = groupSortLookup.get(b.addon_group_id) ?? 0;
    if (ga !== gb) return ga - gb;
    return (a.sort_order ?? 0) - (b.sort_order ?? 0);
  });

  return { ok: errors.length === 0, errors, resolvedAddons };
}
