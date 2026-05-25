import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getVenueStaff } from '@/lib/venue-auth';
import { classMembershipProductPatchSchema, parseMembershipRules } from '@/lib/class-commerce/product-schemas';
import { assertEligibleClassTypesForVenue } from '@/lib/class-commerce/validate-venue-product-refs';
import {
  archiveStripePriceOnConnectedAccount,
  archiveStripeProductOnConnectedAccount,
  createMembershipRecurringProductAndPrice,
} from '@/lib/stripe/connected-membership-product';
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

    const { data: existing, error: exErr } = await staff.db
      .from('class_membership_products')
      .select('*')
      .eq('id', id)
      .eq('venue_id', staff.venue_id)
      .maybeSingle();

    if (exErr || !existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const parsed = classMembershipProductPatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    const existingRow = existing as {
      rules: Record<string, unknown>;
      stripe_price_id: string | null;
      stripe_product_id?: string | null;
      name: string;
      description: string | null;
      currency: string;
      active: boolean;
    };

    const p = parsed.data;
    const nextRules = parseMembershipRules({
      ...(existingRow.rules ?? {}),
      ...(typeof p.rules === 'object' && p.rules !== null ? (p.rules as Record<string, unknown>) : {}),
    });

    if (nextRules.eligible_class_type_ids !== undefined) {
      const typeCheck = await assertEligibleClassTypesForVenue(
        staff.db,
        staff.venue_id,
        nextRules.eligible_class_type_ids ?? null,
      );
      if (!typeCheck.ok) {
        return NextResponse.json({ error: typeCheck.error }, { status: 400 });
      }
    }

    if (p.recurring_interval != null || p.recurring_interval_count != null) {
      (nextRules as Record<string, unknown>).recurring_interval =
        p.recurring_interval ?? (nextRules as { recurring_interval?: string }).recurring_interval ?? 'month';
      (nextRules as Record<string, unknown>).recurring_interval_count =
        p.recurring_interval_count ?? (nextRules as { recurring_interval_count?: number }).recurring_interval_count ?? 1;
    }

    const nextName = p.name ?? existingRow.name;
    const nextDesc = p.description !== undefined ? p.description : existingRow.description;
    const nextCurrency = p.currency ?? existingRow.currency;
    const nextActive = p.active !== undefined ? p.active : existingRow.active;

    const { data: venue } = await staff.db
      .from('venues')
      .select('stripe_connected_account_id')
      .eq('id', staff.venue_id)
      .maybeSingle();
    const stripeAccount = (venue as { stripe_connected_account_id?: string | null } | null)
      ?.stripe_connected_account_id?.trim();

    let stripe_price_id = p.stripe_price_id !== undefined ? p.stripe_price_id : existingRow.stripe_price_id;
    let stripe_product_id =
      p.stripe_product_id !== undefined
        ? p.stripe_product_id
        : ((existingRow as { stripe_product_id?: string | null }).stripe_product_id ?? null);

    const manualPrice = typeof stripe_price_id === 'string' && stripe_price_id.trim().length > 0;
    const autoRequested = p.recurring_price_pence != null && p.recurring_interval != null && Boolean(stripeAccount);

    if (nextActive && !manualPrice && !autoRequested && !existingRow.stripe_price_id?.trim()) {
      return NextResponse.json(
        {
          error:
            'Active memberships need either a Stripe price ID or recurring price + billing interval so customers can subscribe.',
        },
        { status: 400 },
      );
    }

    if (autoRequested) {
      const oldPriceId = existingRow.stripe_price_id?.trim();
      const created = await createMembershipRecurringProductAndPrice({
        stripeAccountId: stripeAccount!,
        productName: nextName,
        productDescription: nextDesc,
        currency: nextCurrency,
        unitAmountPence: p.recurring_price_pence!,
        interval: p.recurring_interval!,
        intervalCount: p.recurring_interval_count ?? 1,
        existingStripeProductId: stripe_product_id,
      });
      stripe_product_id = created.stripe_product_id;
      stripe_price_id = created.stripe_price_id;
      if (oldPriceId && oldPriceId !== stripe_price_id && stripeAccount) {
        await archiveStripePriceOnConnectedAccount(stripeAccount, oldPriceId);
      }
    }

    const updatePayload: Record<string, unknown> = {
      name: nextName,
      description: nextDesc,
      currency: nextCurrency,
      active: nextActive,
      rules: nextRules,
      stripe_price_id,
      stripe_product_id,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await staff.db
      .from('class_membership_products')
      .update(updatePayload)
      .eq('id', id)
      .eq('venue_id', staff.venue_id)
      .select('*')
      .maybeSingle();

    if (error) {
      const msg = (error as { message?: string }).message ?? '';
      if (msg.includes('stripe_product_id')) {
        return NextResponse.json(
          { error: 'Database migration pending: run migrations to add stripe_product_id to class_membership_products.' },
          { status: 500 },
        );
      }
      console.error('[class-membership-products] PATCH', error);
      return NextResponse.json({ error: 'Update failed' }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Phase 2 §5.6 — archive Stripe Product + Price on the active → inactive transition.
    if (existingRow.active === true && nextActive === false && stripeAccount) {
      if (stripe_price_id) {
        await archiveStripePriceOnConnectedAccount(stripeAccount, stripe_price_id);
      }
      if (stripe_product_id) {
        await archiveStripeProductOnConnectedAccount(stripeAccount, stripe_product_id);
      }
    }

    return NextResponse.json({ product: data });
  } catch (e) {
    console.error('[class-membership-products] PATCH', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Internal error' }, { status: 500 });
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
      .from('class_memberships')
      .select('id', { count: 'exact', head: true })
      .eq('product_id', id)
      .in('status', ['active', 'trialing', 'past_due', 'incomplete']);

    if (cErr) {
      console.error('[class-membership-products] DELETE count', cErr);
      return NextResponse.json({ error: 'Could not verify subscriptions' }, { status: 500 });
    }
    if ((count ?? 0) > 0) {
      return NextResponse.json(
        {
          error:
            'This membership cannot be deleted while customers have an active or incomplete subscription. Archive it instead.',
        },
        { status: 409 },
      );
    }

    // Phase 2 §5.6 — archive Stripe artefacts before deleting so the Connect
    // account doesn't carry orphan Products/Prices.
    const { data: existingForDelete } = await staff.db
      .from('class_membership_products')
      .select('stripe_price_id, stripe_product_id')
      .eq('id', id)
      .eq('venue_id', staff.venue_id)
      .maybeSingle();
    const { data: venueForDelete } = await staff.db
      .from('venues')
      .select('stripe_connected_account_id')
      .eq('id', staff.venue_id)
      .maybeSingle();
    const stripeAccountForDelete = (
      venueForDelete as { stripe_connected_account_id?: string | null } | null
    )?.stripe_connected_account_id?.trim();

    if (stripeAccountForDelete && existingForDelete) {
      const priceId = (existingForDelete as { stripe_price_id?: string | null }).stripe_price_id ?? null;
      const productIdOnStripe =
        (existingForDelete as { stripe_product_id?: string | null }).stripe_product_id ?? null;
      if (priceId) await archiveStripePriceOnConnectedAccount(stripeAccountForDelete, priceId);
      if (productIdOnStripe) {
        await archiveStripeProductOnConnectedAccount(stripeAccountForDelete, productIdOnStripe);
      }
    }

    const { error } = await staff.db
      .from('class_membership_products')
      .delete()
      .eq('id', id)
      .eq('venue_id', staff.venue_id);

    if (error) {
      const code = (error as { code?: string }).code;
      if (code === '23503') {
        return NextResponse.json({ error: 'This membership is still referenced and cannot be deleted.' }, { status: 409 });
      }
      console.error('[class-membership-products] DELETE', error);
      return NextResponse.json({ error: 'Delete failed' }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[class-membership-products] DELETE', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
