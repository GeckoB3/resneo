import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveLinkAdmin, enforceLinkRateLimit } from '@/lib/linked-accounts/route-helpers';
import { catalogueActionSchema, type CatalogueActionInput } from '@/lib/linked-accounts/validation';
import {
  loadCatalogueForManagement,
  loadVenueCatalogueData,
  backfillPerCalendarProviders,
} from '@/lib/linked-accounts/catalogue';
import { loadCollectiveAccess } from '@/lib/linked-accounts/collective-access';
import { invalidateCollectiveCatalogMemo } from '@/lib/linked-accounts/collective-venue';
import { loadCollectiveMemberImportSources } from '@/lib/linked-accounts/collective-page-config';
import { ensureServiceForCalendar, loadOfferingTemplate, matchAddonGroupsToOrigin } from '@/lib/linked-accounts/service-duplication';
import { detachCopy, linkCopyToOrigin, loadServiceSyncViews, syncOneCopy } from '@/lib/linked-accounts/service-sync';
import { groupServicesForBulkAdd } from '@/lib/linked-accounts/group-services-for-bulk-add';
import { resolveCollectiveCategoryId } from '@/lib/linked-accounts/collective-categories';
import {
  applyCollectiveCategoryAction,
  inheritCategoryForOffering,
  isCollectiveCategoryAction,
  seedCollectiveCategoriesOnce,
} from '@/lib/linked-accounts/collective-category-inheritance';

/*
 * No email goes to a member when the host puts one of its services on the
 * combined page. It used to, one per offering, which buried members in mail
 * while a page was being built up (removed 2026-09-05). Joining the collective
 * is the consent, and the member's own Services settings still govern the
 * price, duration and availability of anything listed there.
 */

/** GET /api/venue/collectives/[id]/catalogue — the builder dataset (host + members). */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolved = await resolveLinkAdmin();
  if (!resolved.ok) return resolved.response;
  const { ctx } = resolved;
  const { id } = await params;

  try {
    const access = await loadCollectiveAccess(ctx.admin, id, ctx.venueId);
    if (!access) return NextResponse.json({ error: 'Collective not found.' }, { status: 404 });
    if (!access.isHost && !access.memberId) {
      return NextResponse.json({ error: 'You are not a member of this collective.' }, { status: 403 });
    }
    // Self-heal legacy venue-wide providers so the per-calendar checkboxes are accurate.
    if (access.isHost) await backfillPerCalendarProviders(ctx.admin, id);
    // First host visit after the headings migration: inherit headings from the member
    // venues' own categories, once. Later changes are the host's alone.
    if (access.isHost) await seedCollectiveCategoriesOnce(ctx.admin, id);
    const catalogue = await loadCatalogueForManagement(ctx.admin, id);
    // Host-only: each active member's saved booking-page settings, so the host can
    // prefill the combined page from a member venue ("import from", plan §22 / P4).
    const importSources = access.isHost
      ? await loadCollectiveMemberImportSources(ctx.admin, id)
      : [];
    return NextResponse.json({ catalogue, importSources });
  } catch (err) {
    console.error('GET /api/venue/collectives/[id]/catalogue failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** PATCH /api/venue/collectives/[id]/catalogue — host-curated structure (host only). */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolved = await resolveLinkAdmin();
  if (!resolved.ok) return resolved.response;
  const { ctx } = resolved;
  const { id } = await params;

  const limited = enforceLinkRateLimit(ctx.venueId, 'catalogue', 60, 60_000);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const parsed = catalogueActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const input = parsed.data;

  try {
    const access = await loadCollectiveAccess(ctx.admin, id, ctx.venueId);
    if (!access) return NextResponse.json({ error: 'Collective not found.' }, { status: 404 });
    if (access.status !== 'active') {
      return NextResponse.json({ error: 'This collective has been dissolved.' }, { status: 409 });
    }
    if (!access.isHost) {
      return NextResponse.json(
        { error: 'Only the host venue can manage the combined page.' },
        { status: 403 },
      );
    }

    const result = await applyCatalogueAction(ctx.admin, id, ctx.venueId, ctx.userId, input);
    // The booking routes memoise the merged catalogue briefly; a host edit must show
    // on the staff form and the public page at once, not after the window.
    invalidateCollectiveCatalogMemo(id);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    const catalogue = await loadCatalogueForManagement(ctx.admin, id);
    return NextResponse.json({ catalogue });
  } catch (err) {
    console.error('PATCH /api/venue/collectives/[id]/catalogue failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

type ActionResult = { ok: true } | { ok: false; error: string; status: number };

/**
 * Add provider rows for an offering, PER CALENDAR (plan §23 / R1). A specific
 * `practitionerId` adds that one calendar (which must offer the carrier service
 * `sourceServiceId`); a null `practitionerId` expands to every calendar in the
 * venue that offers the service. Model-agnostic (service_items / unified_calendars
 * as well as legacy). Re-activates a previously-removed provider; ignores ones
 * already active. Returns whether anything was added + the member venue id.
 */
async function addProvidersForSource(
  admin: SupabaseClient,
  collectiveId: string,
  itemId: string,
  venueId: string,
  sourceServiceId: string,
  practitionerId: string | null,
  actingVenueId: string,
  userId: string | null,
  overrides?: { pricePence?: number | null; durationMinutes?: number | null },
): Promise<{ ok: true; added: number } | { ok: false; error: string; status: number }> {
  const { data: member } = await admin
    .from('venue_collective_members')
    .select('id')
    .eq('collective_id', collectiveId)
    .eq('venue_id', venueId)
    .eq('status', 'active')
    .maybeSingle();
  if (!member) {
    return { ok: false, error: 'That venue is not an active member of this collective.', status: 400 };
  }
  const data = await loadVenueCatalogueData(admin, venueId);
  if (!data.services.has(sourceServiceId)) {
    return { ok: false, error: 'That service is not available at the chosen venue.', status: 400 };
  }
  const offeringCalendars = data.serviceCalendars.get(sourceServiceId) ?? [];
  let calendarIds: string[];
  if (practitionerId) {
    if (!offeringCalendars.includes(practitionerId)) {
      return { ok: false, error: 'That calendar does not offer the chosen service.', status: 400 };
    }
    calendarIds = [practitionerId];
  } else {
    calendarIds = offeringCalendars;
  }
  if (calendarIds.length === 0) {
    return { ok: false, error: 'No calendars offer that service.', status: 400 };
  }

  // Host-curated: assignments go live immediately (no per-service member consent).
  const approval = 'approved' as const;
  const approvedBy = userId;
  let added = 0;
  for (const calId of calendarIds) {
    const { data: existing } = await admin
      .from('collective_service_providers')
      .select('id, status')
      .eq('item_id', itemId)
      .eq('venue_id', venueId)
      .eq('source_service_id', sourceServiceId)
      .eq('practitioner_id', calId)
      .maybeSingle();
    if (existing) {
      if ((existing.status as string) === 'removed') {
        await admin
          .from('collective_service_providers')
          .update({
            status: 'active',
            approval_status: approval,
            approved_by_user_id: approvedBy,
            price_pence_override: overrides?.pricePence ?? null,
            duration_minutes_override: overrides?.durationMinutes ?? null,
          })
          .eq('id', existing.id);
        added += 1;
      }
      continue;
    }
    await admin.from('collective_service_providers').insert({
      item_id: itemId,
      member_id: member.id,
      venue_id: venueId,
      source_service_id: sourceServiceId,
      practitioner_id: calId,
      price_pence_override: overrides?.pricePence ?? null,
      duration_minutes_override: overrides?.durationMinutes ?? null,
      approval_status: approval,
      approved_by_user_id: approvedBy,
      status: 'active',
    });
    added += 1;
  }
  return { ok: true, added };
}

/**
 * Add a calendar to an offering (the "tick a calendar" path). If the calendar's venue does
 * not already offer the service, it is DUPLICATED into that venue (a real, same-named service
 * linked to the calendar) so both venues can book it — replacing the old carrier mechanism.
 * The copy is exact: every setting of the origin service plus its variants, add-ons, heading
 * and compliance requirements (see the fidelity rule in service-duplication.ts). A copy that
 * cannot be completed is removed again and the tick is refused with the step that failed.
 */
async function addCalendarToOffering(
  admin: SupabaseClient,
  collectiveId: string,
  itemId: string,
  venueId: string,
  calendarId: string,
  actingVenueId: string,
  userId: string | null,
): Promise<
  | {
      ok: true;
      added: number;
      /** The venue's service now behind the calendar, and whether the tick just created it. */
      sourceServiceId: string;
      created: boolean;
    }
  | { ok: false; error: string; status: number }
> {
  const { data: member } = await admin
    .from('venue_collective_members')
    .select('id')
    .eq('collective_id', collectiveId)
    .eq('venue_id', venueId)
    .eq('status', 'active')
    .maybeSingle();
  if (!member) {
    return { ok: false, error: 'That venue is not an active member of this collective.', status: 400 };
  }

  const template = await loadOfferingTemplate(admin, itemId);
  if (!template) return { ok: false, error: 'Offering not found.', status: 404 };

  const resolved = await ensureServiceForCalendar(admin, {
    targetVenueId: venueId,
    targetCalendarId: calendarId,
    offeringName: template.name,
    template,
  });
  if ('error' in resolved) return { ok: false, error: resolved.error, status: 400 };

  // Host-curated: assignments go live immediately (no per-service member consent).
  const approval = 'approved' as const;
  const approvedBy = userId;
  const outcome = { sourceServiceId: resolved.sourceServiceId, created: resolved.created };

  const { data: existing } = await admin
    .from('collective_service_providers')
    .select('id, status')
    .eq('item_id', itemId)
    .eq('venue_id', venueId)
    .eq('source_service_id', resolved.sourceServiceId)
    .eq('practitioner_id', calendarId)
    .maybeSingle();
  if (existing) {
    if ((existing.status as string) === 'removed') {
      await admin
        .from('collective_service_providers')
        .update({ status: 'active', approval_status: approval, approved_by_user_id: approvedBy })
        .eq('id', existing.id);
      return { ok: true, added: 1, ...outcome };
    }
    return { ok: true, added: 0, ...outcome };
  }

  await admin.from('collective_service_providers').insert({
    item_id: itemId,
    member_id: member.id,
    venue_id: venueId,
    source_service_id: resolved.sourceServiceId,
    practitioner_id: calendarId,
    approval_status: approval,
    approved_by_user_id: approvedBy,
    status: 'active',
  });
  return { ok: true, added: 1, ...outcome };
}

/**
 * Bring one copy into step with the offering's origin, whatever state it is in: an
 * independent copy is linked and updated (add-on groups included), a customised or
 * drifted linked copy is re-synced. The origin itself is left alone.
 */
async function bringCopyIntoStep(
  admin: SupabaseClient,
  params: { itemId: string; venueId: string; copyServiceId: string; source: string },
): Promise<{ ok: true; changed: boolean } | { ok: false; error: string }> {
  const template = await loadOfferingTemplate(admin, params.itemId);
  if (!template?.origin) return { ok: false, error: 'This offering has no original service to sync from.' };
  if (template.origin.serviceId === params.copyServiceId || template.origin.venueId === params.venueId) {
    return { ok: true, changed: false };
  }
  const views = await loadServiceSyncViews(
    admin,
    [params.copyServiceId],
    new Map([[params.copyServiceId, template.origin.serviceId]]),
  );
  const view = views.get(params.copyServiceId);
  if (!view) return { ok: false, error: 'Service sync is not available on this database yet.' };
  if (view.state === 'linked' && view.inStep === true) return { ok: true, changed: false };
  if (view.state === 'linked' || view.state === 'customised') {
    const res = await syncOneCopy(admin, params.copyServiceId, { force: true, source: params.source });
    if (!res.ok) return res;
  } else {
    const linked = await linkCopyToOrigin(admin, {
      copyServiceId: params.copyServiceId,
      originServiceId: template.origin.serviceId,
      source: params.source,
    });
    if (!linked.ok) return linked;
  }
  // Add-ons match the origin too: the same groups and options, nothing extra.
  const addons = await matchAddonGroupsToOrigin(admin, params.venueId, params.copyServiceId, template.addonGroups);
  if (!addons) {
    return { ok: false, error: 'The service was updated, but its add-ons could not all be matched. Check the venue’s add-ons.' };
  }
  return { ok: true, changed: true };
}

/** Load a provider scoped to this collective (via its item). */
async function loadProviderInCollective(
  admin: SupabaseClient,
  collectiveId: string,
  providerId: string,
): Promise<{
  id: string;
  itemId: string;
  venue_id: string;
  price_pence_override: number | null;
  duration_minutes_override: number | null;
} | null> {
  const { data } = await admin
    .from('collective_service_providers')
    .select('id, venue_id, price_pence_override, duration_minutes_override, item_id')
    .eq('id', providerId)
    .maybeSingle();
  if (!data) return null;
  const { data: item } = await admin
    .from('collective_service_items')
    .select('id')
    .eq('id', data.item_id as string)
    .eq('collective_id', collectiveId)
    .maybeSingle();
  if (!item) return null;
  return {
    id: data.id as string,
    itemId: data.item_id as string,
    venue_id: data.venue_id as string,
    price_pence_override: (data.price_pence_override as number | null) ?? null,
    duration_minutes_override: (data.duration_minutes_override as number | null) ?? null,
  };
}

/** Verify an item belongs to this collective. */
async function itemBelongsToCollective(
  admin: SupabaseClient,
  collectiveId: string,
  itemId: string,
): Promise<boolean> {
  const { data } = await admin
    .from('collective_service_items')
    .select('id')
    .eq('id', itemId)
    .eq('collective_id', collectiveId)
    .maybeSingle();
  return Boolean(data);
}

/**
 * Create one offering and seed its providers from a set of source services (one
 * provider per calendar that offers each source). Returns the member venues that
 * were seeded from a venue other than the host, so the caller can ask them to
 * approve the terms (plan D6). Used by the bulk `create_items` action.
 */
async function createOfferingSeeded(
  admin: SupabaseClient,
  collectiveId: string,
  actingVenueId: string,
  userId: string | null,
  name: string,
  sources: Array<{ venueId: string; sourceServiceId: string }>,
): Promise<{ ok: boolean }> {
  const { data: item, error } = await admin
    .from('collective_service_items')
    .insert({
      collective_id: collectiveId,
      name: name.trim(),
      pricing_display: 'from',
      allow_any_available: true,
      display_order: 0,
      status: 'active',
    })
    .select('id')
    .single();
  if (error || !item) return { ok: false };

  for (const src of sources) {
    await addProvidersForSource(
      admin,
      collectiveId,
      item.id as string,
      src.venueId,
      src.sourceServiceId,
      null,
      actingVenueId,
      userId,
    );
  }
  // File the offering under the heading its source services carry at their own venues.
  await inheritCategoryForOffering(admin, collectiveId, item.id as string, sources);
  return { ok: true };
}

async function applyCatalogueAction(
  admin: SupabaseClient,
  collectiveId: string,
  actingVenueId: string,
  userId: string | null,
  input: CatalogueActionInput,
): Promise<ActionResult> {
  if (isCollectiveCategoryAction(input.action)) {
    return applyCollectiveCategoryAction(admin, collectiveId, {
      action: input.action,
      categoryId: input.categoryId,
      categoryName: input.categoryName,
      categoryIds: input.categoryIds,
      itemIds: input.itemIds,
    });
  }

  switch (input.action) {
    case 'create_item': {
      if (!input.name) return { ok: false, error: 'A service name is required.', status: 400 };
      const categoryCheck = await resolveCollectiveCategoryId(admin, collectiveId, input.categoryId);
      if (!categoryCheck.ok) return { ok: false, error: categoryCheck.error, status: 400 };
      const { data: item, error } = await admin
        .from('collective_service_items')
        .insert({
          collective_id: collectiveId,
          name: input.name.trim(),
          description: input.description ?? null,
          category_id: categoryCheck.categoryId,
          display_order: input.displayOrder ?? 0,
          default_duration_minutes: input.defaultDurationMinutes ?? null,
          default_price_pence: input.defaultPricePence ?? null,
          pricing_display: input.pricingDisplay ?? 'from',
          allow_any_available: input.allowAnyAvailable ?? true,
          status: 'active',
        })
        .select('id')
        .single();
      if (error || !item) return { ok: false, error: 'Failed to create the offering.', status: 500 };
      // Optionally seed providers from a set of source services (e.g. the picker
      // or an accepted merge) — expanded to one provider per calendar that offers it.
      for (const src of input.sourceServiceIds ?? []) {
        await addProvidersForSource(
          admin,
          collectiveId,
          item.id as string,
          src.venueId,
          src.sourceServiceId,
          null,
          actingVenueId,
          userId,
        );
      }
      // No heading chosen: file it under the one its source services carry at home.
      if (!categoryCheck.categoryId) {
        await inheritCategoryForOffering(admin, collectiveId, item.id as string, input.sourceServiceIds ?? []);
      }
      return { ok: true };
    }

    case 'create_items': {
      if (!input.services || input.services.length === 0) {
        return { ok: false, error: 'No services were selected.', status: 400 };
      }
      // Same-named services across venues merge into one offering (see helper).
      const groups = groupServicesForBulkAdd(input.services);
      if (groups.length === 0) {
        return { ok: false, error: 'No services were selected.', status: 400 };
      }

      let createdAny = false;
      for (const group of groups) {
        const created = await createOfferingSeeded(
          admin,
          collectiveId,
          actingVenueId,
          userId,
          group.name,
          group.sources,
        );
        if (!created.ok) continue; // Skip a single failure; keep adding the rest.
        createdAny = true;
      }
      if (!createdAny) {
        return { ok: false, error: 'Failed to add the selected services.', status: 500 };
      }
      return { ok: true };
    }

    case 'update_item': {
      if (!input.itemId || !(await itemBelongsToCollective(admin, collectiveId, input.itemId))) {
        return { ok: false, error: 'Offering not found.', status: 404 };
      }
      const updates: Record<string, unknown> = {};
      if (input.name !== undefined) updates.name = input.name.trim();
      if (input.description !== undefined) updates.description = input.description;
      if (input.categoryId !== undefined) {
        const categoryCheck = await resolveCollectiveCategoryId(admin, collectiveId, input.categoryId);
        if (!categoryCheck.ok) return { ok: false, error: categoryCheck.error, status: 400 };
        updates.category_id = categoryCheck.categoryId;
      }
      if (input.displayOrder !== undefined) updates.display_order = input.displayOrder;
      if (input.defaultDurationMinutes !== undefined)
        updates.default_duration_minutes = input.defaultDurationMinutes;
      if (input.defaultPricePence !== undefined) updates.default_price_pence = input.defaultPricePence;
      if (input.pricingDisplay !== undefined) updates.pricing_display = input.pricingDisplay;
      if (input.allowAnyAvailable !== undefined) updates.allow_any_available = input.allowAnyAvailable;
      if (input.imageUrl !== undefined) updates.image_url = input.imageUrl || null;
      if (Object.keys(updates).length === 0) return { ok: false, error: 'No changes supplied.', status: 400 };
      const { error } = await admin
        .from('collective_service_items')
        .update(updates)
        .eq('id', input.itemId);
      if (error) return { ok: false, error: 'Failed to update the offering.', status: 500 };
      return { ok: true };
    }

    case 'archive_item': {
      if (!input.itemId || !(await itemBelongsToCollective(admin, collectiveId, input.itemId))) {
        return { ok: false, error: 'Offering not found.', status: 404 };
      }
      await admin
        .from('collective_service_items')
        .update({ status: 'archived' })
        .eq('id', input.itemId);
      // Archiving the offering also removes its providers from public bookability.
      await admin
        .from('collective_service_providers')
        .update({ status: 'removed' })
        .eq('item_id', input.itemId)
        .neq('status', 'removed');
      return { ok: true };
    }

    case 'add_provider': {
      if (!input.itemId || !(await itemBelongsToCollective(admin, collectiveId, input.itemId))) {
        return { ok: false, error: 'Offering not found.', status: 404 };
      }
      if (!input.venueId || !input.practitionerId) {
        return { ok: false, error: 'A venue and calendar are required.', status: 400 };
      }
      // Ticking a calendar: duplicate the service into the calendar's venue if it lacks it.
      const res = await addCalendarToOffering(
        admin,
        collectiveId,
        input.itemId,
        input.venueId,
        input.practitionerId,
        actingVenueId,
        userId,
      );
      if (!res.ok) return res;
      return { ok: true };
    }

    case 'sync_provider':
    case 'detach_provider': {
      // A member's copy following the origin (Docs/collective-service-sync-plan.md). Host
      // only, like every action here; the copy is addressed through its provider row so a
      // host can only reach services the combined page actually lists.
      if (!input.providerId) return { ok: false, error: 'Provider not found.', status: 404 };
      const provider = await loadProviderInCollective(admin, collectiveId, input.providerId);
      if (!provider) return { ok: false, error: 'Provider not found.', status: 404 };
      const { data: providerRow } = await admin
        .from('collective_service_providers')
        .select('source_service_id')
        .eq('id', provider.id)
        .maybeSingle();
      const copyId = (providerRow as { source_service_id?: string } | null)?.source_service_id ?? null;
      if (!copyId) return { ok: false, error: 'Provider not found.', status: 404 };
      const res =
        input.action === 'sync_provider'
          ? await syncOneCopy(admin, copyId, { force: input.forceSync === true, source: 'PATCH catalogue sync_provider' })
          : await detachCopy(admin, copyId);
      if (!res.ok) return { ok: false, error: res.error, status: 409 };
      if (input.action === 'sync_provider') {
        const template = await loadOfferingTemplate(admin, provider.itemId);
        if (template) {
          const addons = await matchAddonGroupsToOrigin(admin, provider.venue_id, copyId, template.addonGroups);
          if (!addons) {
            return { ok: false, error: 'The service was updated, but its add-ons could not all be matched. Check the venue’s add-ons.', status: 409 };
          }
        }
      }
      return { ok: true };
    }

    case 'link_provider': {
      // "Link to {origin} and update": the explicit, per-copy, retroactive action. The origin
      // is the same one the tick copies from, so a linked copy and a fresh copy agree.
      if (!input.providerId) return { ok: false, error: 'Provider not found.', status: 404 };
      const provider = await loadProviderInCollective(admin, collectiveId, input.providerId);
      if (!provider) return { ok: false, error: 'Provider not found.', status: 404 };
      const { data: providerRow } = await admin
        .from('collective_service_providers')
        .select('source_service_id')
        .eq('id', provider.id)
        .maybeSingle();
      const copyId = (providerRow as { source_service_id?: string } | null)?.source_service_id ?? null;
      if (!copyId) return { ok: false, error: 'Provider not found.', status: 404 };
      const template = await loadOfferingTemplate(admin, provider.itemId);
      if (!template?.origin) return { ok: false, error: 'This offering has no original service to link to.', status: 409 };
      if (template.origin.serviceId === copyId) {
        return { ok: false, error: 'That service is the original.', status: 409 };
      }
      const linked = await linkCopyToOrigin(admin, {
        copyServiceId: copyId,
        originServiceId: template.origin.serviceId,
        source: 'PATCH catalogue link_provider',
      });
      if (!linked.ok) return { ok: false, error: linked.error, status: 409 };
      const addons = await matchAddonGroupsToOrigin(admin, provider.venue_id, copyId, template.addonGroups);
      if (!addons) {
        return { ok: false, error: 'The service was linked and updated, but its add-ons could not all be matched. Check the venue’s add-ons.', status: 409 };
      }
      return { ok: true };
    }

    case 'unlink_all_providers': {
      // Every linked or customised copy of every offering (or of one offering) stops
      // following its origin. Nothing about the copies changes but the link.
      let providerQuery = admin
        .from('collective_service_providers')
        .select('id, item_id, venue_id, source_service_id, status, collective_service_items!inner(collective_id)')
        .eq('collective_service_items.collective_id', collectiveId)
        .eq('status', 'active');
      if (input.itemId) providerQuery = providerQuery.eq('item_id', input.itemId);
      const { data: providerRows, error: providerErr } = await providerQuery;
      if (providerErr) {
        console.error('[catalogue] unlink_all_providers read failed:', providerErr.message, { collectiveId });
        return { ok: false, error: 'Could not read the offerings.', status: 500 };
      }
      const seen = new Set<string>();
      const originVenueByItem = new Map<string, string | null>();
      for (const raw of (providerRows ?? []) as Array<Record<string, unknown>>) {
        const itemId = raw.item_id as string;
        const copyId = raw.source_service_id as string;
        if (seen.has(copyId)) continue;
        seen.add(copyId);
        if (!originVenueByItem.has(itemId)) {
          const template = await loadOfferingTemplate(admin, itemId);
          originVenueByItem.set(itemId, template?.origin?.venueId ?? null);
        }
        // The origin's own service is never a copy; an independent copy is a no-op in detachCopy.
        if (originVenueByItem.get(itemId) === (raw.venue_id as string)) continue;
        const res = await detachCopy(admin, copyId);
        if (!res.ok && res.error.startsWith('Service sync is not available')) {
          return { ok: false, error: res.error, status: 409 };
        }
      }
      return { ok: true };
    }

    case 'sync_all_providers': {
      // Every copy of every offering (or of one offering) at a venue other than the
      // origin's is linked and brought into step; the origin services themselves are untouched.
      let providerQuery = admin
        .from('collective_service_providers')
        .select('id, item_id, venue_id, source_service_id, status, collective_service_items!inner(collective_id)')
        .eq('collective_service_items.collective_id', collectiveId)
        .eq('status', 'active');
      if (input.itemId) providerQuery = providerQuery.eq('item_id', input.itemId);
      const { data: providerRows, error: providerErr } = await providerQuery;
      if (providerErr) {
        console.error('[catalogue] sync_all_providers read failed:', providerErr.message, { collectiveId });
        return { ok: false, error: 'Could not read the offerings.', status: 500 };
      }
      const seen = new Set<string>();
      let updated = 0;
      let failed = 0;
      for (const raw of (providerRows ?? []) as Array<Record<string, unknown>>) {
        const copyId = raw.source_service_id as string;
        const key = `${raw.item_id as string}:${copyId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const res = await bringCopyIntoStep(admin, {
          itemId: raw.item_id as string,
          venueId: raw.venue_id as string,
          copyServiceId: copyId,
          source: 'PATCH catalogue sync_all_providers',
        });
        if (!res.ok) {
          failed += 1;
          console.warn('[catalogue] sync_all_providers copy failed:', res.error, { copyId });
        } else if (res.changed) {
          updated += 1;
        }
      }
      if (failed > 0 && updated === 0) {
        return { ok: false, error: 'None of the copies could be updated. Check the venues’ services and try again.', status: 409 };
      }
      return { ok: true };
    }

    case 'remove_provider': {
      if (!input.providerId) return { ok: false, error: 'Provider not found.', status: 404 };
      const provider = await loadProviderInCollective(admin, collectiveId, input.providerId);
      if (!provider) return { ok: false, error: 'Provider not found.', status: 404 };
      await admin
        .from('collective_service_providers')
        .update({ status: 'removed' })
        .eq('id', provider.id);
      return { ok: true };
    }

    case 'set_providers': {
      const ops = input.ops ?? [];
      if (ops.length === 0) return { ok: false, error: 'No changes to save.', status: 400 };

      let applied = 0;

      for (const op of ops) {
        if (op.op === 'remove') {
          if (!op.providerId) continue;
          const provider = await loadProviderInCollective(admin, collectiveId, op.providerId);
          if (!provider) continue;
          await admin
            .from('collective_service_providers')
            .update({ status: 'removed' })
            .eq('id', provider.id);
          applied += 1;
          continue;
        }
        // op.op === 'add' — tick a calendar (duplicates the service into its venue if needed).
        if (!op.itemId || !op.venueId || !op.practitionerId) continue;
        if (!(await itemBelongsToCollective(admin, collectiveId, op.itemId))) continue;
        const res = await addCalendarToOffering(
          admin,
          collectiveId,
          op.itemId,
          op.venueId,
          op.practitionerId,
          actingVenueId,
          userId,
        );
        if (!res.ok) continue; // Skip a single failure; apply the rest.
        applied += 1;
        // The host said yes to "match the original" when ticking a calendar whose venue
        // already had the service. A fresh copy is made in step already.
        if (op.sync && !res.created) {
          const synced = await bringCopyIntoStep(admin, {
            itemId: op.itemId,
            venueId: op.venueId,
            copyServiceId: res.sourceServiceId,
            source: 'PATCH catalogue set_providers sync',
          });
          if (!synced.ok) {
            console.warn('[catalogue] sync on add failed:', synced.error, { itemId: op.itemId, venueId: op.venueId });
          }
        }
      }

      if (applied === 0) {
        return { ok: false, error: 'None of the changes could be applied.', status: 400 };
      }

      return { ok: true };
    }

    default:
      return { ok: false, error: 'Unknown action.', status: 400 };
  }
}
