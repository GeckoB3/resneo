import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createRouteHandlerClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import {
  classRecurringRuleSchema,
  normaliseRuleStartTimeToPgTime,
} from '@/lib/class-commerce/recurring-rule-schema';
import { userVenueHasMembershipAllowingRecurring } from '@/lib/class-commerce/membership-discount';
import {
  extraVenueIdsFromUrl,
  getClassCommerceVenuesForUser,
} from '@/lib/class-commerce/user-venue-scope';

const postSchema = z.object({
  venue_id: z.string().uuid(),
  class_type_id: z.string().uuid(),
  rule: classRecurringRuleSchema,
  next_materialize_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

function defaultNextMaterializeOn(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** GET /api/account/class-recurring */
export async function GET(request: Request) {
  try {
    const supabase = await createRouteHandlerClient(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

    const admin = getSupabaseAdminClient();
    const { data, error } = await admin
      .from('class_recurring_reservations')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[account/class-recurring] GET', error);
      return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
    }

    const rows = data ?? [];
    const typeIds = [...new Set(rows.map((r: { class_type_id: string }) => r.class_type_id))];
    const venueIds = [...new Set(rows.map((r: { venue_id: string }) => r.venue_id))];

    const [{ data: types }, { data: venues }] = await Promise.all([
      typeIds.length
        ? admin.from('class_types').select('id, name, venue_id').in('id', typeIds)
        : Promise.resolve({ data: [] as unknown[] }),
      venueIds.length ? admin.from('venues').select('id, name').in('id', venueIds) : Promise.resolve({ data: [] as unknown[] }),
    ]);

    // Phase 3 §6.4 — scope catalog to venues the user has touched, plus any
    // venue passed via `?venue=` deep-link.
    const scopedVenueIds = await getClassCommerceVenuesForUser(
      admin,
      user.id,
      extraVenueIdsFromUrl(request.url),
    );

    const { data: catalogTypes, error: catErr } =
      scopedVenueIds.length > 0
        ? await admin
            .from('class_types')
            .select('id, name, venue_id')
            .eq('is_active', true)
            .in('venue_id', scopedVenueIds)
            .order('name', { ascending: true })
            .limit(400)
        : { data: [] as unknown[], error: null };

    if (catErr) {
      console.error('[account/class-recurring] catalog types', catErr);
    }

    const tRows = (catalogTypes ?? []) as Array<{ id: string; venue_id: string }>;
    const catalogVenueIds = [...new Set(tRows.map((r) => r.venue_id))];
    const catalogClassTypeIds = tRows.map((r) => r.id);
    const { data: catalogVenues } =
      catalogVenueIds.length > 0
        ? await admin.from('venues').select('id, name').in('id', catalogVenueIds).order('name')
        : { data: [] as unknown[] };

    const { data: timetable } =
      catalogClassTypeIds.length > 0
        ? await admin
            .from('class_timetable')
            .select('class_type_id, day_of_week, start_time')
            .eq('is_active', true)
            .in('class_type_id', catalogClassTypeIds)
            .order('day_of_week', { ascending: true })
            .order('start_time', { ascending: true })
        : { data: [] as unknown[] };

    return NextResponse.json({
      reservations: rows,
      class_types: types ?? [],
      venues: venues ?? [],
      recurring_catalog: {
        venues: catalogVenues ?? [],
        class_types: catalogTypes ?? [],
        timetable_slots: timetable ?? [],
      },
    });
  } catch (e) {
    console.error('[account/class-recurring] GET', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

/** POST /api/account/class-recurring — create a standing rule (materialization via cron). */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createRouteHandlerClient(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

    const json = await request.json().catch(() => ({}));
    const parsed = postSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    const admin = getSupabaseAdminClient();
    const { venue_id, class_type_id, rule } = parsed.data;

    const { data: ct, error: ctErr } = await admin
      .from('class_types')
      .select('id')
      .eq('id', class_type_id)
      .eq('venue_id', venue_id)
      .maybeSingle();

    if (ctErr || !ct) {
      return NextResponse.json({ error: 'Class type not found for this venue' }, { status: 404 });
    }

    // Validate that the (weekday, start_time) actually matches a real, active
    // timetable slot for this class type. Otherwise materialisation will silently
    // produce nothing.
    const { data: slot } = await admin
      .from('class_timetable')
      .select('id')
      .eq('class_type_id', class_type_id)
      .eq('day_of_week', rule.weekday)
      .eq('start_time', normaliseRuleStartTimeToPgTime(rule.start_time))
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    if (!slot) {
      return NextResponse.json(
        { error: 'There is no class at that time on that weekday for this class type.' },
        { status: 400 },
      );
    }

    // Phase 1.4.5.3 — recurring reservations are gated on the user holding a
    // membership at this venue with `allow_recurring: true`.
    const hasAllowRecurring = await userVenueHasMembershipAllowingRecurring(admin, {
      userId: user.id,
      venueId: venue_id,
    });
    if (!hasAllowRecurring) {
      return NextResponse.json(
        {
          error:
            'Recurring auto-bookings require an active membership at this venue with recurring booking enabled.',
        },
        { status: 403 },
      );
    }

    const { data: created, error: insErr } = await admin
      .from('class_recurring_reservations')
      .insert({
        venue_id,
        user_id: user.id,
        class_type_id,
        rule,
        status: 'active',
        next_materialize_on: parsed.data.next_materialize_on ?? defaultNextMaterializeOn(),
      })
      .select('id')
      .single();

    if (insErr || !created) {
      console.error('[account/class-recurring] POST', insErr);
      return NextResponse.json({ error: 'Failed to create' }, { status: 500 });
    }

    return NextResponse.json({ id: created.id }, { status: 201 });
  } catch (e) {
    console.error('[account/class-recurring] POST', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
