import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff, type VenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import type { ServiceCategoryRef } from '@/lib/booking/service-categories';

/**
 * /api/venue/service-categories: the headings a venue groups its services under
 * on the booking pages. See Docs/service-categories-plan.md.
 *
 * Reads are open to any staff member (the Services page and the booking page
 * editor both list categories). Writes are admin-only, matching the services
 * reorder route: category names and their order are the venue's public menu
 * structure, not a per-calendar preference.
 */

const CATEGORY_NAME_MAX = 80;

const nameSchema = z
  .string()
  .transform((v) => v.trim().replace(/\s+/g, ' '))
  .pipe(z.string().min(1, 'Give the category a name.').max(CATEGORY_NAME_MAX));

const createSchema = z.object({ name: nameSchema });
const renameSchema = z.object({ id: z.string().uuid(), name: nameSchema });
const deleteSchema = z.object({ id: z.string().uuid() });

/** Postgres unique_violation: the venue already has this name (case and spacing ignored). */
const UNIQUE_VIOLATION = '23505';

function rowToRef(row: { id: string; name: string; sort_order: number | null }): ServiceCategoryRef {
  return { id: row.id, name: row.name, sort_order: row.sort_order ?? 0 };
}

function duplicateNameResponse(name: string) {
  return NextResponse.json(
    { error: `You already have a category called "${name}".` },
    { status: 409 },
  );
}

async function requireAdmin(
  request: NextRequest,
): Promise<{ staff: VenueStaff } | { response: NextResponse }> {
  const supabase = await createVenueRouteClient(request);
  const staff = await getVenueStaff(supabase);
  if (!staff) return { response: NextResponse.json({ error: 'Unauthorised' }, { status: 401 }) };
  if (staff.role !== 'admin') {
    return {
      response: NextResponse.json(
        { error: 'Only venue admins can change service categories.' },
        { status: 403 },
      ),
    };
  }
  return { staff };
}

/** GET: every category for the venue, in booking-page order. */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const admin = getSupabaseAdminClient();
    const { data, error } = await admin
      .from('service_categories')
      .select('id, name, sort_order')
      .eq('venue_id', staff.venue_id)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });
    if (error) {
      console.error('GET /api/venue/service-categories failed:', error);
      return NextResponse.json({ error: 'Failed to load categories' }, { status: 500 });
    }
    return NextResponse.json({
      categories: ((data ?? []) as Array<{ id: string; name: string; sort_order: number | null }>).map(rowToRef),
    });
  } catch (err) {
    console.error('GET /api/venue/service-categories failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** POST: create a category at the end of the list. */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if ('response' in auth) return auth.response;
    const { staff } = auth;

    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid request', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const admin = getSupabaseAdminClient();
    // Append after the last category. Ties between two categories created
    // together are broken by name until the owner drags them.
    const { data: last } = await admin
      .from('service_categories')
      .select('sort_order')
      .eq('venue_id', staff.venue_id)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextSort = last ? ((last.sort_order as number | null) ?? 0) + 1 : 0;

    const { data, error } = await admin
      .from('service_categories')
      .insert({ venue_id: staff.venue_id, name: parsed.data.name, sort_order: nextSort })
      .select('id, name, sort_order')
      .single();
    if (error) {
      if (error.code === UNIQUE_VIOLATION) return duplicateNameResponse(parsed.data.name);
      console.error('POST /api/venue/service-categories failed:', error);
      return NextResponse.json({ error: 'Failed to create the category' }, { status: 500 });
    }
    return NextResponse.json({ category: rowToRef(data) }, { status: 201 });
  } catch (err) {
    console.error('POST /api/venue/service-categories failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** PATCH: rename a category. */
export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if ('response' in auth) return auth.response;
    const { staff } = auth;

    const parsed = renameSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid request', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const admin = getSupabaseAdminClient();
    const { data, error } = await admin
      .from('service_categories')
      .update({ name: parsed.data.name, updated_at: new Date().toISOString() })
      .eq('id', parsed.data.id)
      .eq('venue_id', staff.venue_id)
      .select('id, name, sort_order')
      .maybeSingle();
    if (error) {
      if (error.code === UNIQUE_VIOLATION) return duplicateNameResponse(parsed.data.name);
      console.error('PATCH /api/venue/service-categories failed:', error);
      return NextResponse.json({ error: 'Failed to rename the category' }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json(
        { error: 'That category no longer exists. Refresh the page and try again.' },
        { status: 404 },
      );
    }
    return NextResponse.json({ category: rowToRef(data) });
  } catch (err) {
    console.error('PATCH /api/venue/service-categories failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE: remove a category. Its services stay and become uncategorised
 * (`service_items.category_id` is ON DELETE SET NULL); nothing about a service
 * is lost. Accepts `{ id }` in the body or `?id=` on the URL.
 */
export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if ('response' in auth) return auth.response;
    const { staff } = auth;

    const fromQuery = request.nextUrl.searchParams.get('id');
    const body = fromQuery ? { id: fromQuery } : await request.json().catch(() => ({}));
    const parsed = deleteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Missing category id' }, { status: 400 });
    }

    const admin = getSupabaseAdminClient();
    const { data, error } = await admin
      .from('service_categories')
      .delete()
      .eq('id', parsed.data.id)
      .eq('venue_id', staff.venue_id)
      .select('id')
      .maybeSingle();
    if (error) {
      console.error('DELETE /api/venue/service-categories failed:', error);
      return NextResponse.json({ error: 'Failed to delete the category' }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json(
        { error: 'That category no longer exists. Refresh the page and try again.' },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/venue/service-categories failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
