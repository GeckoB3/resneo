import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getVenueStaff } from '@/lib/venue-auth';
import { classCreditProductPatchSchema } from '@/lib/class-commerce/product-schemas';
import { assertEligibleClassTypesForVenue } from '@/lib/class-commerce/validate-venue-product-refs';
import { requireClassCommercePlan } from '@/lib/class-commerce/auth';

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
    }
    const gate = await requireClassCommercePlan(staff.db, staff.venue_id);
    if (!gate.ok) return gate.response;

    const body = await request.json().catch(() => ({}));
    const parsed = classCreditProductPatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    if (parsed.data.eligible_class_type_ids !== undefined) {
      const typeCheck = await assertEligibleClassTypesForVenue(
        staff.db,
        staff.venue_id,
        parsed.data.eligible_class_type_ids,
      );
      if (!typeCheck.ok) {
        return NextResponse.json({ error: typeCheck.error }, { status: 400 });
      }
    }

    const patch = Object.fromEntries(
      Object.entries(parsed.data).filter(([, v]) => v !== undefined),
    ) as Record<string, unknown>;

    const { data, error } = await staff.db
      .from('class_credit_products')
      .update({
        ...patch,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('venue_id', staff.venue_id)
      .select('*')
      .maybeSingle();

    if (error) {
      console.error('[class-credit-products] PATCH', error);
      return NextResponse.json({ error: 'Update failed' }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({ product: data });
  } catch (e) {
    console.error('[class-credit-products] PATCH', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
    }
    const gate = await requireClassCommercePlan(staff.db, staff.venue_id);
    if (!gate.ok) return gate.response;

    const { count, error: cErr } = await staff.db
      .from('user_class_credit_balances')
      .select('id', { count: 'exact', head: true })
      .eq('product_id', id);

    if (cErr) {
      console.error('[class-credit-products] DELETE count', cErr);
      return NextResponse.json({ error: 'Could not verify usage' }, { status: 500 });
    }
    if ((count ?? 0) > 0) {
      return NextResponse.json(
        {
          error:
            'This pack cannot be deleted because customers still have credit balances from it. Archive the product instead.',
        },
        { status: 409 },
      );
    }

    const { error } = await staff.db
      .from('class_credit_products')
      .delete()
      .eq('id', id)
      .eq('venue_id', staff.venue_id);

    if (error) {
      const code = (error as { code?: string }).code;
      if (code === '23503') {
        return NextResponse.json(
          { error: 'This pack is still referenced by purchases or ledger history and cannot be deleted.' },
          { status: 409 },
        );
      }
      console.error('[class-credit-products] DELETE', error);
      return NextResponse.json({ error: 'Delete failed' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[class-credit-products] DELETE', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
