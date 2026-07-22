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
import { loadCollectiveMemberImportSources } from '@/lib/linked-accounts/collective-page-config';
import { ensureServiceForCalendar, loadOfferingTemplate } from '@/lib/linked-accounts/service-duplication';
import { loadVenueLookup } from '@/lib/linked-accounts/queries';
import { notifyCombinedProviderProposed } from '@/lib/linked-accounts/notifications';
import { groupServicesForBulkAdd } from '@/lib/linked-accounts/group-services-for-bulk-add';

/** Best-effort: notification failures must never fail a catalogue action. */
async function safeNotify(p: Promise<unknown>): Promise<void> {
  try {
    await p;
  } catch (err) {
    console.error('[combined-page] notification failed:', err);
  }
}

async function collectiveContext(
  admin: SupabaseClient,
  collectiveId: string,
): Promise<{ name: string; hostVenueId: string } | null> {
  const { data } = await admin
    .from('venue_collectives')
    .select('name, host_venue_id')
    .eq('id', collectiveId)
    .maybeSingle();
  if (!data) return null;
  return { name: (data.name as string) ?? 'a venue collective', hostVenueId: data.host_venue_id as string };
}

async function offeringName(admin: SupabaseClient, itemId: string): Promise<string> {
  const { data } = await admin
    .from('collective_service_items')
    .select('name')
    .eq('id', itemId)
    .maybeSingle();
  return (data?.name as string) ?? 'an offering';
}

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
 */
async function addCalendarToOffering(
  admin: SupabaseClient,
  collectiveId: string,
  itemId: string,
  venueId: string,
  calendarId: string,
  actingVenueId: string,
  userId: string | null,
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
      return { ok: true, added: 1 };
    }
    return { ok: true, added: 0 };
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
  return { ok: true, added: 1 };
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
): Promise<{ ok: true; seededMemberVenues: Set<string> } | { ok: false }> {
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

  const seededMemberVenues = new Set<string>();
  for (const src of sources) {
    const res = await addProvidersForSource(
      admin,
      collectiveId,
      item.id as string,
      src.venueId,
      src.sourceServiceId,
      null,
      actingVenueId,
      userId,
    );
    if (res.ok && res.added > 0 && src.venueId !== actingVenueId) seededMemberVenues.add(src.venueId);
  }
  return { ok: true, seededMemberVenues };
}

async function applyCatalogueAction(
  admin: SupabaseClient,
  collectiveId: string,
  actingVenueId: string,
  userId: string | null,
  input: CatalogueActionInput,
): Promise<ActionResult> {
  switch (input.action) {
    case 'create_item': {
      if (!input.name) return { ok: false, error: 'A service name is required.', status: 400 };
      const { data: item, error } = await admin
        .from('collective_service_items')
        .insert({
          collective_id: collectiveId,
          name: input.name.trim(),
          description: input.description ?? null,
          category: input.category ?? null,
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
      const seededMemberVenues = new Set<string>();
      for (const src of input.sourceServiceIds ?? []) {
        const res = await addProvidersForSource(
          admin,
          collectiveId,
          item.id as string,
          src.venueId,
          src.sourceServiceId,
          null,
          actingVenueId,
          userId,
        );
        if (res.ok && res.added > 0 && src.venueId !== actingVenueId) seededMemberVenues.add(src.venueId);
      }
      // Ask each seeded member to approve the terms for its calendars (plan D6).
      if (seededMemberVenues.size > 0) {
        const others = [...seededMemberVenues];
        const [ctx, lookup] = await Promise.all([
          collectiveContext(admin, collectiveId),
          loadVenueLookup(admin, [actingVenueId, ...others]),
        ]);
        const host = lookup[actingVenueId]?.name ?? 'The host venue';
        await Promise.allSettled(
          others.map((v) =>
            safeNotify(
              notifyCombinedProviderProposed(
                admin,
                v,
                ctx?.name ?? 'a venue collective',
                host,
                input.name!.trim(),
                collectiveId,
              ),
            ),
          ),
        );
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

      const proposals: Array<{ venueId: string; name: string }> = [];
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
        for (const venueId of created.seededMemberVenues) proposals.push({ venueId, name: group.name });
      }
      if (!createdAny) {
        return { ok: false, error: 'Failed to add the selected services.', status: 500 };
      }

      // Ask each seeded member to approve the terms for its calendars (plan D6),
      // one notification per proposed offering (matching the single-add flow).
      if (proposals.length > 0) {
        const venueIds = [...new Set(proposals.map((p) => p.venueId))];
        const [ctx, lookup] = await Promise.all([
          collectiveContext(admin, collectiveId),
          loadVenueLookup(admin, [actingVenueId, ...venueIds]),
        ]);
        const host = lookup[actingVenueId]?.name ?? 'The host venue';
        await Promise.allSettled(
          proposals.map((p) =>
            safeNotify(
              notifyCombinedProviderProposed(
                admin,
                p.venueId,
                ctx?.name ?? 'a venue collective',
                host,
                p.name,
                collectiveId,
              ),
            ),
          ),
        );
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
      if (input.category !== undefined) updates.category = input.category;
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
      // Ask the member to approve the terms for its calendar (plan D6).
      if (input.venueId !== actingVenueId && res.added > 0) {
        const [ctx, name, lookup] = await Promise.all([
          collectiveContext(admin, collectiveId),
          offeringName(admin, input.itemId),
          loadVenueLookup(admin, [actingVenueId, input.venueId]),
        ]);
        await safeNotify(
          notifyCombinedProviderProposed(
            admin,
            input.venueId,
            ctx?.name ?? 'a venue collective',
            lookup[actingVenueId]?.name ?? 'The host venue',
            name,
            collectiveId,
          ),
        );
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

    default:
      return { ok: false, error: 'Unknown action.', status: 400 };
  }
}
