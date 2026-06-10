import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { getVenueStaff, requireAdmin } from '@/lib/venue-auth';
import { resolveLinkedStaffCatalogScope } from '@/lib/booking/staff-booking-access';
import {
  addonGroupInputSchema,
  addonGroupLinksArraySchema,
} from '@/lib/addons/zod-schemas';
import {
  loadAddonLibraryForVenue,
  upsertAddonGroup,
  replaceServiceAddonGroupLinks,
} from '@/lib/venue/addon-groups';
import { venueUsesUnifiedAppointmentServiceData } from '@/lib/booking/uses-unified-appointment-data';

const OWNER_VENUE_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/venue/addon-groups
 * Returns every addon_group + its addons + every service link for the venue (or, when
 * `owner_venue_id` is set, the linked owner venue's catalog).
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const admin = getSupabaseAdminClient();
    const url = new URL(request.url);
    const ownerVenueParam = url.searchParams.get('owner_venue_id');
    const includeInactive = url.searchParams.get('include_inactive') === 'true';
    const scope = await resolveLinkedStaffCatalogScope(
      admin,
      staff.venue_id,
      ownerVenueParam && OWNER_VENUE_UUID_RE.test(ownerVenueParam) ? ownerVenueParam : null,
    );
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status });
    }
    const { groups, addonsByGroup, links } = await loadAddonLibraryForVenue({
      admin,
      venueId: scope.venueId,
      includeInactive,
    });
    return NextResponse.json({ groups, addons_by_group: addonsByGroup, service_links: links });
  } catch (err) {
    console.error('GET /api/venue/addon-groups failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

const createBodySchema = z.object({
  group: addonGroupInputSchema,
  service_links: z
    .object({
      service_item_ids: z.array(z.string().uuid()).optional(),
      appointment_service_ids: z.array(z.string().uuid()).optional(),
    })
    .optional(),
});

/** POST /api/venue/addon-groups — admin only */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    if (!requireAdmin(staff)) {
      return NextResponse.json({ error: 'Admin role required.' }, { status: 403 });
    }

    const body = await request.json();
    const parsed = createBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const admin = getSupabaseAdminClient();
    const upserted = await upsertAddonGroup({
      admin,
      venueId: staff.venue_id,
      groupInput: parsed.data.group,
    });
    if (!upserted.ok) {
      return NextResponse.json({ error: upserted.error }, { status: 500 });
    }

    // Optional: link to one or more services in the chosen schema
    const links = parsed.data.service_links;
    if (links) {
      const useUnified = await venueUsesUnifiedAppointmentServiceData(admin, staff.venue_id);
      const ids = useUnified ? links.service_item_ids ?? [] : links.appointment_service_ids ?? [];
      if (ids.length > 0) {
        const inserts = ids.map((id) => ({
          venue_id: staff.venue_id,
          service_item_id: useUnified ? id : null,
          appointment_service_id: useUnified ? null : id,
          addon_group_id: upserted.group.id,
          sort_order: 0,
        }));
        const { error: linkErr } = await admin.from('service_addon_groups').insert(inserts);
        if (linkErr) {
          console.error('POST addon-groups link insert failed:', linkErr);
          // not fatal — the group exists; return what we created
        }
      }
    }

    return NextResponse.json(
      { group: upserted.group, addons: upserted.addons },
      { status: 201 },
    );
  } catch (err) {
    console.error('POST /api/venue/addon-groups failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

const linksUpdateBodySchema = z.object({
  parent_kind: z.enum(['service_item', 'appointment_service']),
  parent_id: z.string().uuid(),
  links: addonGroupLinksArraySchema,
});

/**
 * PUT /api/venue/addon-groups — replace the set of links for one parent service.
 * Convenience endpoint for the dashboard service form; the same data can also be
 * sent via `addon_group_links` on POST/PATCH `/api/venue/appointment-services`.
 */
export async function PUT(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    if (!requireAdmin(staff)) {
      return NextResponse.json({ error: 'Admin role required.' }, { status: 403 });
    }

    const body = await request.json();
    const parsed = linksUpdateBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const admin = getSupabaseAdminClient();
    const result = await replaceServiceAddonGroupLinks({
      admin,
      venueId: staff.venue_id,
      parent:
        parsed.data.parent_kind === 'service_item'
          ? { kind: 'service_item', service_item_id: parsed.data.parent_id }
          : { kind: 'appointment_service', appointment_service_id: parsed.data.parent_id },
      links: parsed.data.links,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }
    return NextResponse.json({ links: result.links });
  } catch (err) {
    console.error('PUT /api/venue/addon-groups failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
