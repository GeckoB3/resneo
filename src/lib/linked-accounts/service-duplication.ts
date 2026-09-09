import type { SupabaseClient } from '@supabase/supabase-js';
import {
  canonicalServiceShape,
  parseProcessingTimeBlocksFromDb,
  validateProcessingTimeBlocks,
} from '@/lib/appointments/processing-time';
import { fetchServiceCategoryRefs } from '@/lib/booking/service-categories-db';
import type { ComplianceCategory, ComplianceCaptureMethod } from '@/lib/compliance/constants';
import type { ComplianceResultType } from '@/lib/compliance/form-schema';
import { createComplianceType } from '@/lib/compliance/types-service';
import { loadVenueCatalogueData, normaliseServiceNameForMerge } from './catalogue';
import { isMissingSyncColumnError } from './service-sync';
import { cleanCategoryName, normaliseCategoryName } from './collective-categories';

/**
 * Cross-venue service duplication for combined booking pages.
 *
 * When the host ticks a calendar from a venue that does NOT offer an offering's service,
 * the service is DUPLICATED into that venue: a real, same-named service in the venue's own
 * catalogue, linked to the chosen calendar, so both venues can genuinely book and manage
 * it. The duplicate is a normal venue service and persists if the collective is later
 * dissolved (non-destructive).
 *
 * FIDELITY RULE. The copy is the origin service as its owner configured it: every column
 * of the `service_items` row (processing time, buffer, deposit and payment rules, booking
 * window, start-time marks, location, custom hours, staff permissions, ...) plus its
 * variants, its add-on groups with their options, its category heading and its compliance
 * requirements. Only identity and venue-scoped references are recomputed for the new
 * venue: the row id, the venue, the display position (appended), the category, add-on
 * groups and compliance types (each matched by name at the new venue, or created there)
 * and the staff author (none). The row is read with `select('*')` and copied through a
 * denylist rather than an allowlist, so a column added to services later is copied without
 * anyone remembering this file; a new venue-scoped foreign key fails the insert loudly
 * instead of being silently dropped, which is how processing time went missing before.
 *
 * A copy is all or nothing: if any part of it cannot be written, the partial service is
 * removed again and the calendar is not assigned, so a half-configured service never
 * appears in a member's catalogue.
 *
 * Every venue keeps its services in `service_items` and its calendar links in
 * `calendar_service_assignments`. The legacy `appointment_services` tables are empty for
 * every venue and are not written here.
 */

type Row = Record<string, unknown>;

/** `service_items` columns recomputed for the copy rather than taken from the origin. */
const SERVICE_COLUMNS_NOT_COPIED = new Set([
  'id',
  'venue_id',
  'name',
  'duration_minutes',
  'price_pence',
  'is_active',
  'sort_order',
  'category_id',
  'created_by_staff_id',
  'created_at',
  'updated_at',
]);

/** Identity and parent pointers on child rows (variants, add-on groups, options, requirements). */
const CHILD_COLUMNS_NOT_COPIED = new Set([
  'id',
  'venue_id',
  'service_item_id',
  'appointment_service_id',
  'addon_group_id',
  'compliance_type_id',
  'created_at',
  'updated_at',
  'archived_at',
]);

/** Postgres unique_violation. */
const UNIQUE_VIOLATION = '23505';

const CATEGORY_NAME_MAX = 80;

function copyColumns(row: Row, skip: ReadonlySet<string>): Row {
  const out: Row = {};
  for (const [key, value] of Object.entries(row)) {
    if (!skip.has(key)) out[key] = value;
  }
  return out;
}

/** Trimmed, single-spaced, lower-cased: how two names are judged to be the same thing. */
function normaliseName(name: unknown): string {
  return String(name ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export interface AddonGroupTemplate {
  /** The origin `addon_groups` row minus identity: selection type, limits, prompt, visibility. */
  group: Row;
  /** The group's unarchived `addons` rows minus identity, in the origin's order. */
  addons: Row[];
  /** The group's position on the origin service (`service_addon_groups.sort_order`). */
  sortOrder: number;
}

export interface ComplianceRequirementTemplate {
  /** The origin requirement minus identity: enforcement, lock period, online collection, scope. */
  requirement: Row;
  /** The origin venue's whole `compliance_types` row, for matching and re-creation. */
  type: Row;
  /** The type's current form schema, needed to re-create the type at a venue that lacks it. */
  formSchema: unknown | null;
}

export interface OfferingTemplate {
  /** Canonical offering name; the duplicated service takes this name. */
  name: string;
  durationMinutes: number;
  pricePence: number | null;
  /**
   * Every other column of the origin `service_items` row, copied verbatim (see
   * SERVICE_COLUMNS_NOT_COPIED). Empty when the offering has no provider left to copy from.
   */
  columns: Row;
  /** Heading to file the copy under: the origin's own category, else the offering's heading. */
  categoryName: string | null;
  variants: Row[];
  addonGroups: AddonGroupTemplate[];
  complianceRequirements: ComplianceRequirementTemplate[];
  /** Where the copy was taken from, for diagnostics. */
  origin: { venueId: string; serviceId: string } | null;
}

/**
 * The provider whose real service the copy is taken from. The host venue's own service
 * wins when the host provides the offering (the same preference the combined page gives
 * the host's description and heading); otherwise the earliest provider.
 */
export async function pickOriginProvider(
  admin: SupabaseClient,
  itemId: string,
  collectiveId: string | null,
): Promise<{ venueId: string; serviceId: string } | null> {
  const { data: providers } = await admin
    .from('collective_service_providers')
    .select('venue_id, source_service_id')
    .eq('item_id', itemId)
    .eq('status', 'active')
    .order('created_at', { ascending: true });
  const list = ((providers ?? []) as Row[]).filter((p) => p.venue_id && p.source_service_id);
  if (list.length === 0) return null;

  let hostVenueId: string | null = null;
  if (collectiveId) {
    const { data: collective } = await admin
      .from('venue_collectives')
      .select('host_venue_id')
      .eq('id', collectiveId)
      .maybeSingle();
    hostVenueId = ((collective as Row | null)?.host_venue_id as string | null) ?? null;
  }
  const pick = (hostVenueId && list.find((p) => p.venue_id === hostVenueId)) || list[0]!;
  return { venueId: pick.venue_id as string, serviceId: pick.source_service_id as string };
}

/**
 * Processing gaps for the copy. Same duration as the origin: the stored JSON is copied
 * verbatim. A different duration (the host set a default on the offering): gaps that no
 * longer fit are dropped and the rest re-validated, since a gap past the end of the
 * service would be rejected by the venue's own Services page.
 */
function processingBlocksForCopy(raw: unknown, originDuration: number | null, copyDuration: number): unknown {
  if (originDuration === copyDuration) return raw ?? [];
  const fitting = parseProcessingTimeBlocksFromDb(raw).filter(
    (b) => b.start_minute + b.duration_minutes <= copyDuration,
  );
  const check = validateProcessingTimeBlocks(fitting, copyDuration);
  if (!check.ok) {
    console.warn('[service-duplication] processing gaps dropped from the copy:', check.error);
    return [];
  }
  return check.normalized ?? [];
}

async function loadOriginVariants(admin: SupabaseClient, origin: { venueId: string; serviceId: string }) {
  const { data, error } = await admin
    .from('service_variants')
    .select('*')
    .eq('venue_id', origin.venueId)
    .eq('service_item_id', origin.serviceId)
    .order('sort_order', { ascending: true });
  if (error) {
    console.error('[service-duplication] variants read failed:', error.message);
    return [];
  }
  return ((data ?? []) as Row[]).map((v) => copyColumns(v, CHILD_COLUMNS_NOT_COPIED));
}

async function loadOriginAddonGroups(
  admin: SupabaseClient,
  origin: { venueId: string; serviceId: string },
): Promise<AddonGroupTemplate[]> {
  const { data: links, error } = await admin
    .from('service_addon_groups')
    .select('*')
    .eq('venue_id', origin.venueId)
    .eq('service_item_id', origin.serviceId)
    .order('sort_order', { ascending: true });
  if (error) {
    console.error('[service-duplication] add-on links read failed:', error.message);
    return [];
  }
  const linkRows = (links ?? []) as Row[];
  const groupIds = [...new Set(linkRows.map((l) => l.addon_group_id as string).filter(Boolean))];
  if (groupIds.length === 0) return [];

  const [groupsRes, addonsRes] = await Promise.all([
    admin.from('addon_groups').select('*').in('id', groupIds),
    admin
      .from('addons')
      .select('*')
      .in('addon_group_id', groupIds)
      .is('archived_at', null)
      .order('sort_order', { ascending: true }),
  ]);
  const groups = (groupsRes.data ?? []) as Row[];
  const addons = (addonsRes.data ?? []) as Row[];

  const templates: AddonGroupTemplate[] = [];
  linkRows.forEach((link, idx) => {
    const group = groups.find((g) => g.id === link.addon_group_id);
    if (!group) return;
    templates.push({
      group: copyColumns(group, CHILD_COLUMNS_NOT_COPIED),
      addons: addons
        .filter((a) => a.addon_group_id === group.id)
        .map((a) => copyColumns(a, CHILD_COLUMNS_NOT_COPIED)),
      sortOrder: (link.sort_order as number | null) ?? idx,
    });
  });
  return templates;
}

async function loadOriginComplianceRequirements(
  admin: SupabaseClient,
  origin: { venueId: string; serviceId: string },
): Promise<ComplianceRequirementTemplate[]> {
  const { data: reqs, error } = await admin
    .from('service_compliance_requirements')
    .select('*')
    .eq('venue_id', origin.venueId)
    .eq('service_item_id', origin.serviceId);
  if (error) {
    console.error('[service-duplication] compliance requirements read failed:', error.message);
    return [];
  }
  const reqRows = (reqs ?? []) as Row[];
  const typeIds = [...new Set(reqRows.map((r) => r.compliance_type_id as string).filter(Boolean))];
  if (typeIds.length === 0) return [];

  const { data: typeRows } = await admin.from('compliance_types').select('*').in('id', typeIds);
  // Requirements on archived types are not enforced and cannot be re-created (the venue's
  // own Services page refuses them too), so they are left behind.
  const types = ((typeRows ?? []) as Row[]).filter((t) => t.is_active !== false && !t.archived_at);
  const versionIds = types.map((t) => t.current_version_id as string | null).filter((v): v is string => Boolean(v));
  const { data: versionRows } = versionIds.length
    ? await admin.from('compliance_type_versions').select('id, form_schema').in('id', versionIds)
    : { data: [] as Row[] };
  const schemaByVersion = new Map(((versionRows ?? []) as Row[]).map((v) => [v.id as string, v.form_schema]));

  const templates: ComplianceRequirementTemplate[] = [];
  for (const req of reqRows) {
    const type = types.find((t) => t.id === req.compliance_type_id);
    if (!type) continue;
    templates.push({
      requirement: copyColumns(req, CHILD_COLUMNS_NOT_COPIED),
      type,
      formSchema: schemaByVersion.get((type.current_version_id as string | null) ?? '') ?? null,
    });
  }
  return templates;
}

/**
 * The heading the copy is filed under. The origin's own category at its venue first; when it
 * has none, the offering's heading on the combined page. Both reads are tolerant: the
 * category tables arrive with migrations applied by hand per environment.
 */
async function resolveTemplateCategoryName(
  admin: SupabaseClient,
  originCategoryId: string | null,
  offeringCategoryId: string | null,
): Promise<string | null> {
  if (originCategoryId) {
    const { data } = await admin
      .from('service_categories')
      .select('name')
      .eq('id', originCategoryId)
      .maybeSingle();
    const name = (data as Row | null)?.name;
    if (typeof name === 'string' && name.trim()) return cleanCategoryName(name);
  }
  if (offeringCategoryId) {
    const { data } = await admin
      .from('collective_service_categories')
      .select('name')
      .eq('id', offeringCategoryId)
      .maybeSingle();
    const name = (data as Row | null)?.name;
    if (typeof name === 'string' && name.trim()) return cleanCategoryName(name);
  }
  return null;
}

/**
 * Everything needed to reproduce an offering's service in another venue: the canonical
 * name, duration and price (from the offering, falling back to its origin service) and the
 * origin service in full, with its variants, add-on groups, heading and compliance
 * requirements. The origin is an existing active provider of the offering, the member venue
 * that already has the real service (see {@link pickOriginProvider}).
 */
export async function loadOfferingTemplate(
  admin: SupabaseClient,
  itemId: string,
): Promise<OfferingTemplate | null> {
  // `select('*')`: `category_id` arrives with migration 20270202130000, applied by hand per
  // environment, and naming a column the database lacks fails the whole read.
  const { data: offeringRow } = await admin
    .from('collective_service_items')
    .select('*')
    .eq('id', itemId)
    .maybeSingle();
  if (!offeringRow) return null;
  const offering = offeringRow as Row;
  const name = (offering.name as string) ?? '';

  const origin = await pickOriginProvider(admin, itemId, (offering.collective_id as string | null) ?? null);
  const empty: OfferingTemplate = {
    name,
    durationMinutes: (offering.default_duration_minutes as number | null) || 30,
    pricePence: (offering.default_price_pence as number | null) ?? null,
    columns: {},
    categoryName: await resolveTemplateCategoryName(admin, null, (offering.category_id as string | null) ?? null),
    variants: [],
    addonGroups: [],
    complianceRequirements: [],
    origin: null,
  };
  if (!origin) return empty;

  const { data: serviceRow } = await admin
    .from('service_items')
    .select('*')
    .eq('id', origin.serviceId)
    .eq('venue_id', origin.venueId)
    .maybeSingle();
  if (!serviceRow) return empty;
  const service = serviceRow as Row;

  const originDuration = (service.duration_minutes as number | null) ?? null;
  const durationMinutes =
    (offering.default_duration_minutes as number | null) || originDuration || 30;
  const pricePence =
    (offering.default_price_pence as number | null) ?? (service.price_pence as number | null) ?? null;

  const columns = copyColumns(service, SERVICE_COLUMNS_NOT_COPIED);
  let copyDurationMinutes = durationMinutes;
  if ('processing_time_blocks' in service) {
    // The copy carries the canonical shape whatever the origin row holds, so a
    // member's copy books the same length as its origin.
    const canon = canonicalServiceShape({
      durationMinutes,
      processingBlocks: parseProcessingTimeBlocksFromDb(
        processingBlocksForCopy(service.processing_time_blocks, originDuration, durationMinutes),
      ),
    });
    columns.processing_time_blocks = canon.processingBlocks;
    copyDurationMinutes = canon.durationMinutes;
  }

  const [variants, addonGroups, complianceRequirements, categoryName] = await Promise.all([
    loadOriginVariants(admin, origin),
    loadOriginAddonGroups(admin, origin),
    loadOriginComplianceRequirements(admin, origin),
    resolveTemplateCategoryName(
      admin,
      (service.category_id as string | null | undefined) ?? null,
      (offering.category_id as string | null | undefined) ?? null,
    ),
  ]);

  return {
    name,
    durationMinutes: copyDurationMinutes,
    pricePence,
    columns,
    categoryName,
    variants,
    addonGroups,
    complianceRequirements,
    origin,
  };
}

// ---------------------------------------------------------------------------
// Writing the copy into the target venue
// ---------------------------------------------------------------------------

/**
 * The target venue's heading of this name, created at the end of its list when missing.
 * Tolerant: without the categories migration the read yields nothing and the insert fails,
 * and the copy is simply left uncategorised, as the venue's own services are.
 */
async function ensureVenueCategory(
  admin: SupabaseClient,
  venueId: string,
  name: string,
): Promise<string | null> {
  const cleaned = cleanCategoryName(name).slice(0, CATEGORY_NAME_MAX);
  if (!cleaned) return null;
  const key = normaliseCategoryName(cleaned);
  const existing = await fetchServiceCategoryRefs(admin, venueId);
  const hit = existing.find((c) => normaliseCategoryName(c.name) === key);
  if (hit) return hit.id;

  const nextSort = existing.length > 0 ? Math.max(...existing.map((c) => c.sort_order)) + 1 : 0;
  const { data, error } = await admin
    .from('service_categories')
    .insert({ venue_id: venueId, name: cleaned, sort_order: nextSort })
    .select('id')
    .single();
  if (error || !data) {
    if (error?.code === UNIQUE_VIOLATION) {
      const again = await fetchServiceCategoryRefs(admin, venueId);
      return again.find((c) => normaliseCategoryName(c.name) === key)?.id ?? null;
    }
    console.warn('[service-duplication] category create failed; copy left uncategorised:', error?.message);
    return null;
  }
  return (data as Row).id as string;
}

/**
 * Display position for the copy, the rule the Services page uses for a new service: venues
 * that have dragged their services into an order get it appended; untouched venues keep 0.
 */
async function nextServiceSortOrder(admin: SupabaseClient, venueId: string): Promise<number> {
  const { data } = await admin
    .from('service_items')
    .select('sort_order')
    .eq('venue_id', venueId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const max = ((data as Row | null)?.sort_order as number | null) ?? 0;
  return max > 0 ? max + 1 : 0;
}

async function copyVariants(
  admin: SupabaseClient,
  venueId: string,
  serviceId: string,
  variants: Row[],
): Promise<boolean> {
  if (variants.length === 0) return true;
  const rows = variants.map((v, idx) => {
    const canon = canonicalServiceShape({
      durationMinutes: (v.duration_minutes as number) ?? 30,
      processingBlocks: parseProcessingTimeBlocksFromDb(v.processing_time_blocks),
    });
    return {
      ...v,
      venue_id: venueId,
      service_item_id: serviceId,
      sort_order: (v.sort_order as number | null) ?? idx,
      duration_minutes: canon.durationMinutes,
      processing_time_blocks: canon.processingBlocks,
    };
  });
  const { error } = await admin.from('service_variants').insert(rows);
  if (error) {
    console.error('[service-duplication] variants insert failed:', error.message);
    return false;
  }
  return true;
}

interface TargetAddonGroup {
  id: string;
  nameKey: string;
  selectionType: unknown;
  optionKey: string;
}

/** The option names of a group, order-insensitive, so two groups can be judged the same. */
function addonOptionKey(addons: Row[]): string {
  return JSON.stringify(addons.map((a) => normaliseName(a.name)).sort());
}

/** The target venue's active add-on groups with their unarchived options, for matching. */
async function loadTargetAddonGroups(admin: SupabaseClient, venueId: string): Promise<TargetAddonGroup[]> {
  const [groupsRes, addonsRes] = await Promise.all([
    admin.from('addon_groups').select('*').eq('venue_id', venueId).eq('is_active', true),
    admin.from('addons').select('*').eq('venue_id', venueId).is('archived_at', null),
  ]);
  const addons = (addonsRes.data ?? []) as Row[];
  return ((groupsRes.data ?? []) as Row[]).map((g) => ({
    id: g.id as string,
    nameKey: normaliseName(g.name),
    selectionType: g.selection_type,
    optionKey: addonOptionKey(addons.filter((a) => a.addon_group_id === g.id)),
  }));
}

/**
 * Link the copy to the same add-on groups as the origin. A group the target venue already
 * has (same name, same selection type, same option names) is reused, so copying two
 * offerings that share a group does not leave the venue with the group twice; anything else
 * is created there with its options. Ids of groups created here are collected so a failed
 * copy can remove them again.
 */
async function copyAddonGroups(
  admin: SupabaseClient,
  venueId: string,
  serviceId: string,
  groups: AddonGroupTemplate[],
  createdGroupIds: string[],
  /** Groups the service already links to; those are left alone (the update path). */
  alreadyLinked: ReadonlySet<string> = new Set(),
): Promise<boolean> {
  if (groups.length === 0) return true;
  const library = await loadTargetAddonGroups(admin, venueId);
  const links: Row[] = [];
  const linked = new Set<string>(alreadyLinked);

  for (const [idx, tpl] of groups.entries()) {
    const nameKey = normaliseName(tpl.group.name);
    const optionKey = addonOptionKey(tpl.addons);
    let groupId =
      library.find(
        (g) => g.nameKey === nameKey && g.selectionType === tpl.group.selection_type && g.optionKey === optionKey,
      )?.id ?? null;

    if (!groupId) {
      const { data: created, error } = await admin
        .from('addon_groups')
        .insert({ ...tpl.group, venue_id: venueId })
        .select('id')
        .single();
      if (error || !created) {
        console.error('[service-duplication] add-on group insert failed:', error?.message);
        return false;
      }
      groupId = (created as Row).id as string;
      createdGroupIds.push(groupId);
      if (tpl.addons.length > 0) {
        const { error: addonErr } = await admin.from('addons').insert(
          tpl.addons.map((a, i) => ({
            ...a,
            venue_id: venueId,
            addon_group_id: groupId,
            sort_order: (a.sort_order as number | null) ?? i,
          })),
        );
        if (addonErr) {
          console.error('[service-duplication] add-on options insert failed:', addonErr.message);
          return false;
        }
      }
      library.push({ id: groupId, nameKey, selectionType: tpl.group.selection_type, optionKey });
    }

    if (linked.has(groupId)) continue; // two origin links resolved to one target group
    linked.add(groupId);
    links.push({
      venue_id: venueId,
      service_item_id: serviceId,
      addon_group_id: groupId,
      sort_order: tpl.sortOrder ?? idx,
    });
  }

  if (links.length === 0) return true;
  const { error } = await admin.from('service_addon_groups').insert(links);
  if (error) {
    console.error('[service-duplication] add-on links insert failed:', error.message);
    return false;
  }
  return true;
}

/**
 * Give an EXISTING service at the target venue every add-on group of the origin it lacks
 * (reused by name where the venue has one, created otherwise), leaving the groups it
 * already links to untouched. The "link to origin and update" action; a created group that
 * cannot be linked is not rolled back, since the service itself is not new.
 */
export async function ensureAddonGroupLinksForService(
  admin: SupabaseClient,
  venueId: string,
  serviceId: string,
  groups: AddonGroupTemplate[],
): Promise<boolean> {
  const { data: existing } = await admin
    .from('service_addon_groups')
    .select('addon_group_id')
    .eq('venue_id', venueId)
    .eq('service_item_id', serviceId);
  const alreadyLinked = new Set(((existing ?? []) as Row[]).map((r) => r.addon_group_id as string));
  return copyAddonGroups(admin, venueId, serviceId, groups, [], alreadyLinked);
}

/**
 * The target venue's compliance type standing in for the origin's: the same library
 * template when both were installed from the library, else the same name; failing both,
 * the type is created at the target venue with the origin's settings and current form.
 */
async function resolveComplianceTypeInVenue(
  admin: SupabaseClient,
  venueId: string,
  tpl: ComplianceRequirementTemplate,
  targetTypes: Row[],
): Promise<string | null> {
  const librarySlug = (tpl.type.library_template_slug as string | null) ?? null;
  const nameKey = normaliseName(tpl.type.name);
  const hit =
    (librarySlug ? targetTypes.find((t) => t.library_template_slug === librarySlug) : undefined) ??
    targetTypes.find((t) => normaliseName(t.name) === nameKey);
  if (hit) return hit.id as string;

  if (tpl.formSchema == null) {
    console.error('[service-duplication] compliance type has no current form to copy:', tpl.type.id);
    return null;
  }
  const created = await createComplianceType(admin, {
    venueId,
    staffId: null,
    name: String(tpl.type.name ?? 'Compliance type'),
    category: tpl.type.category as ComplianceCategory,
    resultType: tpl.type.result_type as ComplianceResultType,
    validityPeriodDays: (tpl.type.validity_period_days as number | null) ?? null,
    captureMethods: (tpl.type.capture_methods as ComplianceCaptureMethod[] | null) ?? [],
    description: (tpl.type.description as string | null) ?? null,
    formLinkExpiryDays: (tpl.type.form_link_expiry_days as number | null) ?? null,
    onlineUnmetMessage: (tpl.type.online_unmet_message as string | null) ?? null,
    formSchema: tpl.formSchema,
    libraryTemplateSlug: librarySlug,
  });
  if (!created.ok) {
    console.error('[service-duplication] compliance type create failed:', created.error);
    return null;
  }
  targetTypes.push(created.value.type);
  return created.value.type.id;
}

async function copyComplianceRequirements(
  admin: SupabaseClient,
  venueId: string,
  serviceId: string,
  requirements: ComplianceRequirementTemplate[],
): Promise<boolean> {
  if (requirements.length === 0) return true;
  const { data: typeRows, error: typesErr } = await admin
    .from('compliance_types')
    .select('*')
    .eq('venue_id', venueId)
    .eq('is_active', true)
    .is('archived_at', null);
  if (typesErr) {
    console.error('[service-duplication] compliance types read failed:', typesErr.message);
    return false;
  }
  const targetTypes = (typeRows ?? []) as Row[];

  const rows: Row[] = [];
  const seen = new Set<string>();
  for (const tpl of requirements) {
    const typeId = await resolveComplianceTypeInVenue(admin, venueId, tpl, targetTypes);
    if (!typeId) return false;
    if (seen.has(typeId)) continue; // one requirement per type, as the unique index demands
    seen.add(typeId);
    rows.push({ ...tpl.requirement, venue_id: venueId, service_item_id: serviceId, compliance_type_id: typeId });
  }
  const { error } = await admin.from('service_compliance_requirements').insert(rows);
  if (error) {
    console.error('[service-duplication] compliance requirements insert failed:', error.message);
    return false;
  }
  return true;
}

/**
 * Write the copy: the service row, then its variants, add-on groups and compliance
 * requirements. Any failure after the row exists removes the row (its children cascade)
 * and the add-on groups created on the way, and reports the step that failed.
 */
async function createServiceInVenue(
  admin: SupabaseClient,
  venueId: string,
  name: string,
  template: OfferingTemplate | null,
): Promise<{ id: string } | { error: string }> {
  const categoryId = template?.categoryName ? await ensureVenueCategory(admin, venueId, template.categoryName) : null;
  const sortOrder = await nextServiceSortOrder(admin, venueId);

  const row: Row = {
    // Defaults for an offering with no origin service to copy from; overwritten by the
    // origin's columns when there is one.
    item_type: 'service',
    price_type: 'fixed',
    is_bookable_online: true,
    processing_time_minutes: 0,
    ...(template?.columns ?? {}),
    venue_id: venueId,
    name,
    duration_minutes: template?.durationMinutes || 30,
    price_pence: template?.pricePence ?? null,
    is_active: true,
    sort_order: sortOrder,
    created_by_staff_id: null,
    // Only named when resolved: on a database without the categories migration the
    // column does not exist and naming it would fail the insert.
    ...(categoryId ? { category_id: categoryId } : {}),
  };
  // The copy follows its origin from here on (Docs/collective-service-sync-plan.md). A
  // database without migration 20270209120000 refuses the three columns; the copy is then
  // made without them and stays independent, exactly as every copy did before.
  const syncColumns: Row = template?.origin
    ? { synced_from_service_id: template.origin.serviceId, sync_state: 'linked', synced_at: new Date().toISOString() }
    : {};
  let inserted = await admin.from('service_items').insert({ ...row, ...syncColumns }).select('id').single();
  if (inserted.error && Object.keys(syncColumns).length > 0 && isMissingSyncColumnError(inserted.error)) {
    inserted = await admin.from('service_items').insert(row).select('id').single();
  }
  const { data, error } = inserted;
  if (error || !data) {
    console.error('[service-duplication] service insert failed:', error?.message);
    return { error: 'Failed to create the service.' };
  }
  const serviceId = (data as Row).id as string;
  if (!template) return { id: serviceId };

  const createdGroupIds: string[] = [];
  const rollback = async (step: string): Promise<{ error: string }> => {
    console.error(`[service-duplication] ${step} failed; removing the partial copy`, {
      venueId,
      serviceId,
      origin: template.origin,
    });
    await admin.from('service_items').delete().eq('id', serviceId).eq('venue_id', venueId);
    if (createdGroupIds.length > 0) {
      await admin.from('addon_groups').delete().in('id', createdGroupIds).eq('venue_id', venueId);
    }
    return { error: `Failed to copy the service's ${step}.` };
  };

  if (!(await copyVariants(admin, venueId, serviceId, template.variants))) return rollback('options');
  if (!(await copyAddonGroups(admin, venueId, serviceId, template.addonGroups, createdGroupIds))) {
    return rollback('add-ons');
  }
  if (!(await copyComplianceRequirements(admin, venueId, serviceId, template.complianceRequirements))) {
    return rollback('compliance requirements');
  }
  return { id: serviceId };
}

async function linkCalendarToService(admin: SupabaseClient, calendarId: string, serviceId: string): Promise<boolean> {
  const { error } = await admin
    .from('calendar_service_assignments')
    .upsert(
      { calendar_id: calendarId, service_item_id: serviceId },
      { onConflict: 'calendar_id,service_item_id', ignoreDuplicates: true },
    );
  return !error;
}

/**
 * Resolve which service a calendar should book an offering as, in the calendar's OWN venue,
 * creating/linking as needed:
 *  1. the calendar already offers a same-named service → use it;
 *  2. the venue has a same-named service on another calendar → link this calendar to it;
 *  3. otherwise → duplicate the offering's service into the venue and link the calendar.
 */
export async function ensureServiceForCalendar(
  admin: SupabaseClient,
  args: {
    targetVenueId: string;
    targetCalendarId: string;
    offeringName: string;
    template: OfferingTemplate | null;
  },
): Promise<{ sourceServiceId: string; created: boolean } | { error: string }> {
  const { targetVenueId, targetCalendarId, offeringName } = args;
  const key = normaliseServiceNameForMerge(offeringName);
  const data = await loadVenueCatalogueData(admin, targetVenueId);

  if (!data.calendars.has(targetCalendarId)) {
    return { error: 'That calendar does not belong to the chosen venue.' };
  }

  // 1. Calendar already offers a same-named service.
  for (const [sid, svc] of data.services) {
    if (
      normaliseServiceNameForMerge(svc.name) === key &&
      (data.serviceCalendars.get(sid) ?? []).includes(targetCalendarId)
    ) {
      return { sourceServiceId: sid, created: false };
    }
  }

  // 2. Venue has a same-named service elsewhere → link this calendar to it.
  for (const [sid, svc] of data.services) {
    if (normaliseServiceNameForMerge(svc.name) === key) {
      const linked = await linkCalendarToService(admin, targetCalendarId, sid);
      if (!linked) return { error: 'Failed to assign the service to the calendar.' };
      return { sourceServiceId: sid, created: false };
    }
  }

  // 3. Duplicate the service into the venue, then link the calendar.
  const created = await createServiceInVenue(admin, targetVenueId, offeringName, args.template);
  if ('error' in created) return created;
  const linked = await linkCalendarToService(admin, targetCalendarId, created.id);
  if (!linked) return { error: 'Failed to assign the new service to the calendar.' };
  return { sourceServiceId: created.id, created: true };
}
