import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getVenueStaff } from '@/lib/venue-auth';
import {
  classMembershipProductBodySchema,
  parseMembershipRules,
} from '@/lib/class-commerce/product-schemas';
import { assertEligibleClassTypesForVenue } from '@/lib/class-commerce/validate-venue-product-refs';
import { createMembershipRecurringProductAndPrice } from '@/lib/stripe/connected-membership-product';
import { requireClassCommercePlan } from '@/lib/class-commerce/auth';

/**
 * GET /api/venue/class-membership-products — list membership products (staff).
 * POST — create; creates Stripe Product + recurring Price on the venue connected account when billing fields are provided.
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
    }
    const gate = await requireClassCommercePlan(staff.db, staff.venue_id);
    if (!gate.ok) return gate.response;

    const { data, error } = await staff.db
      .from('class_membership_products')
      .select('*')
      .eq('venue_id', staff.venue_id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[class-membership-products] GET', error);
      return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
    }
    return NextResponse.json({ products: data ?? [] });
  } catch (e) {
    console.error('[class-membership-products] GET', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
    }
    const gate = await requireClassCommercePlan(staff.db, staff.venue_id);
    if (!gate.ok) return gate.response;

    const body = await request.json().catch(() => ({}));
    const parsed = classMembershipProductBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    const rulesIn = parseMembershipRules(parsed.data.rules);
    const typeCheck = await assertEligibleClassTypesForVenue(
      staff.db,
      staff.venue_id,
      rulesIn.eligible_class_type_ids ?? null,
    );
    if (!typeCheck.ok) {
      return NextResponse.json({ error: typeCheck.error }, { status: 400 });
    }

    const { data: venue, error: vErr } = await staff.db
      .from('venues')
      .select('stripe_connected_account_id')
      .eq('id', staff.venue_id)
      .maybeSingle();

    if (vErr || !venue) {
      return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
    }

    const stripeAccount = (venue as { stripe_connected_account_id?: string | null }).stripe_connected_account_id?.trim();
    const wantsAutoStripe =
      parsed.data.active !== false &&
      !parsed.data.stripe_price_id?.trim() &&
      parsed.data.recurring_price_pence != null &&
      parsed.data.recurring_interval != null;

    const wantsManualStripe = Boolean(parsed.data.stripe_price_id?.trim());

    if (parsed.data.active !== false && !wantsManualStripe && !wantsAutoStripe) {
      return NextResponse.json(
        {
          error:
            'Active memberships need either a Stripe price ID or recurring price + billing interval so customers can subscribe.',
        },
        { status: 400 },
      );
    }

    if (wantsAutoStripe && !stripeAccount) {
      return NextResponse.json(
        { error: 'Connect Stripe for this venue before selling memberships with card billing.' },
        { status: 400 },
      );
    }

    let stripe_price_id: string | null = parsed.data.stripe_price_id?.trim() || null;
    let stripe_product_id: string | null = parsed.data.stripe_product_id?.trim() || null;

    const mergedRules = {
      ...rulesIn,
      ...(parsed.data.recurring_interval
        ? {
            recurring_interval: parsed.data.recurring_interval,
            recurring_interval_count: parsed.data.recurring_interval_count ?? 1,
          }
        : {}),
    };

    if (wantsAutoStripe && stripeAccount) {
      const created = await createMembershipRecurringProductAndPrice({
        stripeAccountId: stripeAccount,
        productName: parsed.data.name,
        productDescription: parsed.data.description ?? null,
        currency: parsed.data.currency ?? 'gbp',
        unitAmountPence: parsed.data.recurring_price_pence!,
        interval: parsed.data.recurring_interval!,
        intervalCount: parsed.data.recurring_interval_count ?? 1,
        existingStripeProductId: stripe_product_id,
      });
      stripe_product_id = created.stripe_product_id;
      stripe_price_id = created.stripe_price_id;
    }

    const { data, error } = await staff.db
      .from('class_membership_products')
      .insert({
        venue_id: staff.venue_id,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        stripe_price_id,
        stripe_product_id,
        currency: parsed.data.currency ?? 'gbp',
        rules: mergedRules,
        active: parsed.data.active ?? true,
      })
      .select('*')
      .single();

    if (error || !data) {
      console.error('[class-membership-products] POST', error);
      return NextResponse.json({ error: 'Failed to create' }, { status: 500 });
    }
    return NextResponse.json({ product: data }, { status: 201 });
  } catch (e) {
    console.error('[class-membership-products] POST', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Internal error' }, { status: 500 });
  }
}
