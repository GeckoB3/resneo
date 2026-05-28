import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Addon,
  AddonGroup,
  AppointmentCatalogAddonGroup,
  ServiceAddonGroupLink,
} from '@/types/booking-models';

export type AppointmentParentSchema = 'service_item' | 'appointment_service';

function mapAddonGroupRow(row: Record<string, unknown>): AddonGroup {
  return {
    id: row.id as string,
    venue_id: row.venue_id as string,
    name: row.name as string,
    prompt_to_client: (row.prompt_to_client as string | null) ?? null,
    description: (row.description as string | null) ?? null,
    selection_type: (row.selection_type as 'single' | 'multi'),
    min_select: (row.min_select as number) ?? 0,
    max_select: (row.max_select as number | null) ?? null,
    hidden_from_online: Boolean(row.hidden_from_online),
    is_active: row.is_active !== false,
    sort_order: (row.sort_order as number) ?? 0,
    created_at: (row.created_at as string) ?? new Date().toISOString(),
    updated_at: (row.updated_at as string) ?? new Date().toISOString(),
  };
}

function mapAddonRow(row: Record<string, unknown>): Addon {
  return {
    id: row.id as string,
    addon_group_id: row.addon_group_id as string,
    venue_id: row.venue_id as string,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    additional_price_pence: (row.additional_price_pence as number) ?? 0,
    additional_duration_minutes: (row.additional_duration_minutes as number) ?? 0,
    cost_to_business_pence: (row.cost_to_business_pence as number | null) ?? null,
    is_active: row.is_active !== false,
    sort_order: (row.sort_order as number) ?? 0,
    archived_at: (row.archived_at as string | null) ?? null,
    created_at: (row.created_at as string) ?? new Date().toISOString(),
    updated_at: (row.updated_at as string) ?? new Date().toISOString(),
  };
}

function mapServiceAddonGroupLinkRow(row: Record<string, unknown>): ServiceAddonGroupLink {
  return {
    id: row.id as string,
    venue_id: row.venue_id as string,
    service_item_id: (row.service_item_id as string | null) ?? null,
    appointment_service_id: (row.appointment_service_id as string | null) ?? null,
    addon_group_id: row.addon_group_id as string,
    sort_order: (row.sort_order as number) ?? 0,
  };
}

export { mapAddonGroupRow, mapAddonRow, mapServiceAddonGroupLinkRow };

/**
 * Load every addon group + its options for a list of services (in either schema).
 * Returns a Map keyed by parent service id so callers (catalog API, dashboard API)
 * can attach `addon_groups` to each service.
 *
 * `includeHidden` / `includeInactive` allow staff callers to see hidden_from_online
 * groups and inactive items (booking modify / staff catalog).
 */
export async function loadAddonGroupsForServices(params: {
  admin: SupabaseClient;
  venueId: string;
  schema: AppointmentParentSchema;
  parentIds: string[];
  includeHidden?: boolean;
  includeInactive?: boolean;
}): Promise<Map<string, AppointmentCatalogAddonGroup[]>> {
  const { admin, venueId, schema, parentIds, includeHidden, includeInactive } = params;
  const result = new Map<string, AppointmentCatalogAddonGroup[]>();
  if (parentIds.length === 0) return result;

  const filterColumn =
    schema === 'service_item' ? 'service_item_id' : 'appointment_service_id';

  const linkRes = await admin
    .from('service_addon_groups')
    .select('*')
    .eq('venue_id', venueId)
    .in(filterColumn, parentIds)
    .order('sort_order', { ascending: true });

  if (linkRes.error) {
    console.error('loadAddonGroupsForServices links failed:', linkRes.error);
    return result;
  }
  const links = ((linkRes.data ?? []) as Record<string, unknown>[]).map(mapServiceAddonGroupLinkRow);
  if (links.length === 0) return result;

  const groupIds = [...new Set(links.map((l) => l.addon_group_id))];

  const groupRes = await admin
    .from('addon_groups')
    .select('*')
    .eq('venue_id', venueId)
    .in('id', groupIds);
  if (groupRes.error) {
    console.error('loadAddonGroupsForServices groups failed:', groupRes.error);
    return result;
  }
  const allGroups = ((groupRes.data ?? []) as Record<string, unknown>[]).map(mapAddonGroupRow);
  const groupsById = new Map<string, AddonGroup>(allGroups.map((g) => [g.id, g]));

  const addonRes = await admin
    .from('addons')
    .select('*')
    .eq('venue_id', venueId)
    .in('addon_group_id', groupIds)
    .order('sort_order', { ascending: true });
  if (addonRes.error) {
    console.error('loadAddonGroupsForServices addons failed:', addonRes.error);
    return result;
  }
  const allAddons = ((addonRes.data ?? []) as Record<string, unknown>[]).map(mapAddonRow);
  const addonsByGroup = new Map<string, Addon[]>();
  for (const a of allAddons) {
    if (!includeInactive) {
      if (!a.is_active) continue;
      if (a.archived_at) continue;
    }
    const list = addonsByGroup.get(a.addon_group_id) ?? [];
    list.push(a);
    addonsByGroup.set(a.addon_group_id, list);
  }

  for (const link of links) {
    const group = groupsById.get(link.addon_group_id);
    if (!group) continue;
    if (!includeInactive && !group.is_active) continue;
    if (!includeHidden && group.hidden_from_online) continue;

    const parentId =
      schema === 'service_item' ? link.service_item_id : link.appointment_service_id;
    if (!parentId) continue;

    const entry: AppointmentCatalogAddonGroup = {
      group,
      addons: addonsByGroup.get(group.id) ?? [],
      link_sort_order: link.sort_order,
    };

    const arr = result.get(parentId) ?? [];
    arr.push(entry);
    result.set(parentId, arr);
  }

  for (const [k, arr] of result) {
    arr.sort((a, b) => {
      if (a.link_sort_order !== b.link_sort_order) return a.link_sort_order - b.link_sort_order;
      return a.group.sort_order - b.group.sort_order;
    });
    result.set(k, arr);
  }

  return result;
}

/**
 * Convenience: load groups + addons for a single service, returning an empty array
 * when nothing is linked.
 */
export async function loadAddonGroupsForService(params: {
  admin: SupabaseClient;
  venueId: string;
  schema: AppointmentParentSchema;
  parentId: string;
  includeHidden?: boolean;
  includeInactive?: boolean;
}): Promise<AppointmentCatalogAddonGroup[]> {
  const map = await loadAddonGroupsForServices({
    admin: params.admin,
    venueId: params.venueId,
    schema: params.schema,
    parentIds: [params.parentId],
    includeHidden: params.includeHidden,
    includeInactive: params.includeInactive,
  });
  return map.get(params.parentId) ?? [];
}

/**
 * Resolve a list of addon ids against a service (whichever schema). Returns the loaded
 * `Addon` rows + the `AddonGroup` rows their groups belong to + a map keyed by id for
 * fast lookups. Used by booking-create routes after Zod parsing.
 *
 * `includeHidden` controls whether `hidden_from_online` groups are kept (true = staff path).
 */
export async function loadAddonsForBooking(params: {
  admin: SupabaseClient;
  venueId: string;
  schema: AppointmentParentSchema;
  parentId: string;
  includeHidden: boolean;
}): Promise<{
  groups: Array<{ group: AddonGroup; addons: Addon[] }>;
  addonsById: Map<string, Addon>;
  groupsById: Map<string, AddonGroup>;
}> {
  const catalog = await loadAddonGroupsForService({
    admin: params.admin,
    venueId: params.venueId,
    schema: params.schema,
    parentId: params.parentId,
    includeHidden: params.includeHidden,
    includeInactive: false,
  });
  const groups = catalog.map((c) => ({ group: c.group, addons: c.addons }));
  const addonsById = new Map<string, Addon>();
  const groupsById = new Map<string, AddonGroup>();
  for (const { group, addons } of groups) {
    groupsById.set(group.id, group);
    for (const a of addons) addonsById.set(a.id, a);
  }
  return { groups, addonsById, groupsById };
}
