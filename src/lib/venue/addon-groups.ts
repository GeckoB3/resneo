import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Addon,
  AddonGroup,
  AppointmentCatalogAddonGroup,
  ServiceAddonGroupLink,
} from '@/types/booking-models';
import type { AddonGroupInput, AddonInput, AddonGroupLinkInput } from '@/lib/addons/zod-schemas';
import {
  mapAddonGroupRow,
  mapAddonRow,
  mapServiceAddonGroupLinkRow,
  type AppointmentParentSchema,
} from '@/lib/addons/addon-resolution';

/**
 * Upsert an addon group: when `groupInput.id` is present, the row is updated;
 * otherwise a fresh row is inserted. The embedded `addons` array is deleted
 * and re-inserted, mirroring the variant pattern.
 */
export async function upsertAddonGroup(params: {
  admin: SupabaseClient;
  venueId: string;
  groupInput: AddonGroupInput;
  existingId?: string;
}): Promise<
  | { ok: true; group: AddonGroup; addons: Addon[] }
  | { ok: false; error: string }
> {
  const { admin, venueId, groupInput, existingId } = params;
  const groupRow = {
    venue_id: venueId,
    name: groupInput.name.trim(),
    prompt_to_client: groupInput.prompt_to_client?.trim() || null,
    description: groupInput.description?.trim() || null,
    selection_type: groupInput.selection_type,
    min_select: groupInput.min_select ?? 0,
    max_select:
      groupInput.max_select === undefined
        ? groupInput.selection_type === 'single'
          ? 1
          : null
        : groupInput.max_select,
    hidden_from_online: groupInput.hidden_from_online ?? false,
    is_active: groupInput.is_active ?? true,
    sort_order: groupInput.sort_order ?? 0,
  };

  const targetId = existingId ?? groupInput.id;
  let savedGroupRow: Record<string, unknown> | null;
  if (targetId) {
    const upd = await admin
      .from('addon_groups')
      .update(groupRow)
      .eq('id', targetId)
      .eq('venue_id', venueId)
      .select()
      .single();
    if (upd.error) {
      console.error('upsertAddonGroup update failed:', upd.error);
      return { ok: false, error: 'Failed to update add-on group' };
    }
    savedGroupRow = upd.data as Record<string, unknown>;
  } else {
    const ins = await admin.from('addon_groups').insert(groupRow).select().single();
    if (ins.error) {
      console.error('upsertAddonGroup insert failed:', ins.error);
      return { ok: false, error: 'Failed to create add-on group' };
    }
    savedGroupRow = ins.data as Record<string, unknown>;
  }

  const savedGroup = mapAddonGroupRow(savedGroupRow!);

  const replaced = await replaceAddonsForGroup({
    admin,
    venueId,
    groupId: savedGroup.id,
    addons: groupInput.addons,
  });
  if (!replaced.ok) return replaced;

  return { ok: true, group: savedGroup, addons: replaced.addons };
}

/**
 * Delete + re-insert the addons inside a group. Returns the freshly written addon rows.
 */
export async function replaceAddonsForGroup(params: {
  admin: SupabaseClient;
  venueId: string;
  groupId: string;
  addons: AddonInput[];
}): Promise<{ ok: true; addons: Addon[] } | { ok: false; error: string }> {
  const { admin, venueId, groupId, addons } = params;
  const delRes = await admin
    .from('addons')
    .delete()
    .eq('addon_group_id', groupId)
    .eq('venue_id', venueId);
  if (delRes.error) {
    console.error('replaceAddonsForGroup delete failed:', delRes.error);
    return { ok: false, error: 'Failed to clear existing add-ons' };
  }
  if (addons.length === 0) return { ok: true, addons: [] };
  const rows = addons.map((a, idx) => ({
    addon_group_id: groupId,
    venue_id: venueId,
    name: a.name.trim(),
    description: a.description?.trim() || null,
    additional_price_pence: a.additional_price_pence,
    additional_duration_minutes: a.additional_duration_minutes,
    cost_to_business_pence: a.cost_to_business_pence ?? null,
    is_active: a.is_active ?? true,
    sort_order: a.sort_order ?? idx,
  }));
  const insRes = await admin.from('addons').insert(rows).select();
  if (insRes.error) {
    console.error('replaceAddonsForGroup insert failed:', insRes.error);
    return { ok: false, error: 'Failed to save add-on options' };
  }
  const saved = ((insRes.data ?? []) as Record<string, unknown>[]).map(mapAddonRow);
  return { ok: true, addons: saved };
}

/**
 * Replace the full set of service ↔ addon-group links for a parent service. Same
 * delete+insert approach as variants — sort_order is preserved when supplied.
 */
export async function replaceServiceAddonGroupLinks(params: {
  admin: SupabaseClient;
  venueId: string;
  parent:
    | { kind: 'service_item'; service_item_id: string }
    | { kind: 'appointment_service'; appointment_service_id: string };
  links: AddonGroupLinkInput[];
}): Promise<{ ok: true; links: ServiceAddonGroupLink[] } | { ok: false; error: string }> {
  const { admin, venueId, parent, links } = params;
  const filterColumn =
    parent.kind === 'service_item' ? 'service_item_id' : 'appointment_service_id';
  const parentId =
    parent.kind === 'service_item' ? parent.service_item_id : parent.appointment_service_id;

  const delRes = await admin
    .from('service_addon_groups')
    .delete()
    .eq('venue_id', venueId)
    .eq(filterColumn, parentId);
  if (delRes.error) {
    console.error('replaceServiceAddonGroupLinks delete failed:', delRes.error);
    return { ok: false, error: 'Failed to clear existing add-on links' };
  }
  if (links.length === 0) return { ok: true, links: [] };

  // De-dupe by addon_group_id; keep first occurrence's sort_order
  const seen = new Set<string>();
  const cleaned = links.filter((l) => {
    if (seen.has(l.addon_group_id)) return false;
    seen.add(l.addon_group_id);
    return true;
  });

  const rows = cleaned.map((l, idx) => ({
    venue_id: venueId,
    service_item_id: parent.kind === 'service_item' ? parent.service_item_id : null,
    appointment_service_id:
      parent.kind === 'appointment_service' ? parent.appointment_service_id : null,
    addon_group_id: l.addon_group_id,
    sort_order: l.sort_order ?? idx,
  }));

  const insRes = await admin.from('service_addon_groups').insert(rows).select();
  if (insRes.error) {
    console.error('replaceServiceAddonGroupLinks insert failed:', insRes.error);
    return { ok: false, error: 'Failed to save add-on links' };
  }
  const saved = ((insRes.data ?? []) as Record<string, unknown>[]).map(mapServiceAddonGroupLinkRow);
  return { ok: true, links: saved };
}

/** Load every addon group + its options for a venue (admin/library page). */
export async function loadAddonLibraryForVenue(params: {
  admin: SupabaseClient;
  venueId: string;
  includeInactive: boolean;
}): Promise<{
  groups: AddonGroup[];
  addonsByGroup: Record<string, Addon[]>;
  links: ServiceAddonGroupLink[];
}> {
  const { admin, venueId, includeInactive } = params;

  const groupQuery = admin
    .from('addon_groups')
    .select('*')
    .eq('venue_id', venueId)
    .order('sort_order', { ascending: true });

  const [groupsRes, addonsRes, linksRes] = await Promise.all([
    includeInactive ? groupQuery : groupQuery.eq('is_active', true),
    admin
      .from('addons')
      .select('*')
      .eq('venue_id', venueId)
      .order('sort_order', { ascending: true }),
    admin.from('service_addon_groups').select('*').eq('venue_id', venueId),
  ]);

  if (groupsRes.error) {
    console.error('loadAddonLibraryForVenue groups failed:', groupsRes.error);
    return { groups: [], addonsByGroup: {}, links: [] };
  }
  const groups = ((groupsRes.data ?? []) as Record<string, unknown>[]).map(mapAddonGroupRow);
  const addons = ((addonsRes.data ?? []) as Record<string, unknown>[]).map(mapAddonRow);
  const addonsByGroup: Record<string, Addon[]> = {};
  for (const g of groups) addonsByGroup[g.id] = [];
  for (const a of addons) {
    if (!includeInactive && (!a.is_active || a.archived_at)) continue;
    if (!addonsByGroup[a.addon_group_id]) addonsByGroup[a.addon_group_id] = [];
    addonsByGroup[a.addon_group_id]!.push(a);
  }
  const links = ((linksRes.data ?? []) as Record<string, unknown>[]).map(mapServiceAddonGroupLinkRow);
  return { groups, addonsByGroup, links };
}

/** Whether the group has any booking_addons rows pointing at any of its addons. */
export async function addonGroupHasBookings(
  admin: SupabaseClient,
  groupId: string,
): Promise<boolean> {
  const { count, error } = await admin
    .from('booking_addons')
    .select('id', { count: 'exact', head: true })
    .eq('addon_group_id', groupId);
  if (error) {
    console.error('addonGroupHasBookings failed:', error);
    return true;
  }
  return (count ?? 0) > 0;
}

/**
 * Convenience for catalog rendering: builds AppointmentCatalogAddonGroup[] for a
 * specific parent service id given pre-loaded data.
 */
export function buildCatalogGroupsForParent(params: {
  parentId: string;
  schema: AppointmentParentSchema;
  groups: AddonGroup[];
  addonsByGroup: Record<string, Addon[]>;
  links: ServiceAddonGroupLink[];
  includeHidden?: boolean;
}): AppointmentCatalogAddonGroup[] {
  const { parentId, schema, groups, addonsByGroup, links, includeHidden } = params;
  const groupsById = new Map(groups.map((g) => [g.id, g]));
  const out: AppointmentCatalogAddonGroup[] = [];
  for (const link of links) {
    const ownsParent =
      schema === 'service_item'
        ? link.service_item_id === parentId
        : link.appointment_service_id === parentId;
    if (!ownsParent) continue;
    const group = groupsById.get(link.addon_group_id);
    if (!group) continue;
    if (!group.is_active) continue;
    if (!includeHidden && group.hidden_from_online) continue;
    out.push({
      group,
      addons: addonsByGroup[group.id] ?? [],
      link_sort_order: link.sort_order,
    });
  }
  out.sort((a, b) => {
    if (a.link_sort_order !== b.link_sort_order) return a.link_sort_order - b.link_sort_order;
    return a.group.sort_order - b.group.sort_order;
  });
  return out;
}
