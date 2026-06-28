import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { stripe } from '@/lib/stripe';
import {
  buildCheckoutLineItems,
  buildLightPlanCheckoutLineItems,
  buildSignupCheckoutSubscriptionData,
  buildSignupCheckoutSubscriptionDataWithReferral,
  buildSignupCheckoutSubscriptionDataWithSales,
} from '@/lib/stripe/subscription-line-items';
import { getBusinessConfig } from '@/lib/business-config';
import { validateReferralCode } from '@/lib/referrals/lookup';
import { referralProgrammeEnabled } from '@/lib/referrals/constants';
import { validateSalesCode } from '@/lib/sales/lookup';
import { salesProgrammeEnabled } from '@/lib/sales/constants';
import { attachSalesAttributionOnSignup } from '@/lib/sales/attach-on-signup';
import { attachReferralOnSignup } from '@/lib/referrals/attach-on-signup';
import { FOUNDING_PARTNER_CAP } from '@/lib/pricing-constants';
import { getExistingVenueForUserEmail } from '@/lib/signup-existing-venue';
import { pricingTierToSignupFamily, signupPlanToFamily, SIGNUP_PLAN_CONFLICT_MESSAGE } from '@/lib/signup-plan-family';
import { clearSignupPendingUserMetadata } from '@/lib/signup-pending-metadata';
import { DEFAULT_VENUE_BOOKING_LOG_EMAIL_CONFIG } from '@/lib/reports/booking-log-email-config';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const body = await request.json();
    const {
      business_type: rawBusinessType,
      plan,
      referral_code: rawReferralCode,
      sales_code: rawSalesCode,
    } = body as {
      business_type?: string | null;
      plan: 'appointments' | 'plus' | 'light' | 'restaurant' | 'founding';
      referral_code?: string | null;
      sales_code?: string | null;
    };
    const business_type =
      rawBusinessType?.trim() || (plan === 'appointments' || plan === 'plus' || plan === 'light' ? 'other' : '');

    if (!plan || (plan !== 'appointments' && plan !== 'plus' && plan !== 'light' && !business_type)) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const config = getBusinessConfig(business_type);

    const admin = getSupabaseAdminClient();
    const existingVenue = await getExistingVenueForUserEmail(admin, user.email);
    if (existingVenue) {
      const requestedFamily = signupPlanToFamily(plan);
      const existingFamily = pricingTierToSignupFamily(existingVenue.pricing_tier);
      if (existingFamily !== requestedFamily) {
        return NextResponse.json(
          { error: SIGNUP_PLAN_CONFLICT_MESSAGE, code: 'PLAN_FAMILY_MISMATCH' },
          { status: 409 },
        );
      }
      if (
        (existingVenue.pricing_tier === 'appointments' ||
          existingVenue.pricing_tier === 'plus' ||
          existingVenue.pricing_tier === 'light') &&
        Array.isArray((existingVenue as { active_booking_models?: unknown }).active_booking_models) &&
        ((existingVenue as { active_booking_models?: unknown[] }).active_booking_models?.length ?? 0) === 0
      ) {
        return NextResponse.json({ redirect_url: '/signup/booking-models' });
      }
      return NextResponse.json({ redirect_url: '/onboarding' });
    }

    // Founding Partner: skip Stripe, create venue directly
    if (plan === 'founding') {
      if (config.model !== 'table_reservation') {
        return NextResponse.json(
          { error: 'Founding Partner plan is only available for hospitality businesses' },
          { status: 400 },
        );
      }
      const { count: foundingCount, error: foundingCountErr } = await admin
        .from('venues')
        .select('id', { count: 'exact', head: true })
        .eq('pricing_tier', 'founding');
      if (!foundingCountErr) {
        if ((foundingCount ?? 0) >= FOUNDING_PARTNER_CAP) {
          return NextResponse.json(
            { error: 'Founding Partner places are full. Please choose the Business plan.' },
            { status: 400 },
          );
        }
      }

      const slug = `venue-${Date.now()}`;
      const foundingEnd = new Date();
      foundingEnd.setMonth(foundingEnd.getMonth() + 6);

      const ownerEmail = (user.email ?? '').trim().toLowerCase() || null;

      const { data: venue, error: venueError } = await admin
        .from('venues')
        .insert({
          name: 'My Business',
          slug,
          booking_model: config.model,
          business_type,
          business_category: config.category,
          terminology: config.terms,
          pricing_tier: 'founding',
          plan_status: 'active',
          calendar_count: null,
          onboarding_step: 0,
          onboarding_completed: false,
          founding_free_period_ends_at: foundingEnd.toISOString(),
          email: ownerEmail,
          daily_booking_log_email_config: DEFAULT_VENUE_BOOKING_LOG_EMAIL_CONFIG,
        })
        .select('id')
        .single();

      if (venueError || !venue) {
        return NextResponse.json(
          { error: 'Failed to create venue: ' + (venueError?.message ?? 'unknown') },
          { status: 500 },
        );
      }

      const { error: staffError } = await admin.from('staff').insert({
        venue_id: venue.id,
        email: user.email,
        name: user.email?.split('@')[0] ?? 'Admin',
        role: 'admin',
        // Durable auth link: identity resolution prefers user_id over the
        // fragile email match, which breaks when the sign-in email changes.
        user_id: user.id,
      });

      if (staffError) {
        return NextResponse.json(
          { error: 'Failed to create staff record: ' + staffError.message },
          { status: 500 },
        );
      }

      // Founding partners skip Stripe, so attribution must be attached here (no checkout
      // session / webhook will). The trial bonus is moot — founding already gets 6 months free.
      try {
        if (salesProgrammeEnabled() && rawSalesCode) {
          await attachSalesAttributionOnSignup({
            admin,
            salesCode: rawSalesCode,
            referredVenueId: venue.id,
            refereeEmail: ownerEmail,
            refereeUserId: user.id,
          });
        } else if (referralProgrammeEnabled() && rawReferralCode) {
          await attachReferralOnSignup({
            admin,
            referralCode: rawReferralCode,
            referredVenueId: venue.id,
            refereeEmail: ownerEmail,
          });
        }
      } catch (e) {
        console.error('[create-checkout] founding attribution failed (non-fatal):', e);
      }

      await clearSignupPendingUserMetadata(admin, user.id);

      return NextResponse.json({ redirect_url: '/onboarding' });
    }

    // Appointments Light: card-required subscription checkout (£20/mo + 6p SMS overage meter)
    if (plan === 'light') {
      if (config.model === 'table_reservation') {
        return NextResponse.json(
          { error: 'Appointments Light is only available for non-restaurant businesses.' },
          { status: 400 },
        );
      }
    }

    const priceIdMap: Record<
      'appointments' | 'plus' | 'restaurant',
      { priceId: string | undefined; envName: string }
    > = {
      appointments: {
        priceId: process.env.STRIPE_APPOINTMENTS_PRO_PRICE_ID,
        envName: 'STRIPE_APPOINTMENTS_PRO_PRICE_ID',
      },
      plus: {
        priceId: process.env.STRIPE_APPOINTMENTS_PLUS_PRICE_ID,
        envName: 'STRIPE_APPOINTMENTS_PLUS_PRICE_ID',
      },
      restaurant: {
        priceId: process.env.STRIPE_RESTAURANT_PRICE_ID,
        envName: 'STRIPE_RESTAURANT_PRICE_ID',
      },
    };

    let lineItems: Stripe.Checkout.SessionCreateParams.LineItem[];

    if (plan === 'light') {
      try {
        lineItems = buildLightPlanCheckoutLineItems(1);
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Light plan prices not configured';
        console.error('[create-checkout] Light:', msg);
        return NextResponse.json({ error: msg }, { status: 500 });
      }
    } else {
      const entry = priceIdMap[plan as keyof typeof priceIdMap];
      const priceId = entry?.priceId?.trim();
      if (!priceId || !entry) {
        const envName = entry?.envName ?? 'STRIPE_*_PRICE_ID for this plan';
        return NextResponse.json(
          {
            error: `${envName} is not set or empty. Add it in Vercel (same Stripe account/mode as STRIPE_SECRET_KEY), e.g. from scripts/create-stripe-products.ts output.`,
          },
          { status: 500 },
        );
      }
      lineItems = buildCheckoutLineItems(priceId, 1);
    }

    const existingCustomers = await stripe.customers.list({
      email: user.email ?? undefined,
      limit: 1,
    });
    const customer =
      existingCustomers.data[0] ??
      (await stripe.customers.create({
        email: user.email,
        metadata: {
          supabase_user_id: user.id,
          business_type,
          plan,
        },
      }));

    const quantity = 1;

    const origin =
      process.env.NEXT_PUBLIC_BASE_URL ||
      request.headers.get('origin') ||
      'http://localhost:3000';

    // Sales programme takes precedence over venue referral programme.
    let salesForSession: { code: string; salesperson_id: string; trial_days: number } | null = null;
    if (salesProgrammeEnabled() && rawSalesCode) {
      const salesValidation = await validateSalesCode(admin, rawSalesCode);
      if (salesValidation.ok) {
        salesForSession = {
          code: salesValidation.value.code,
          salesperson_id: salesValidation.value.salesperson_id,
          trial_days: salesValidation.value.trial_days,
        };
      } else {
        console.log('[create-checkout] sales code dropped:', salesValidation.reason);
      }
    }

    let referralForSession: { code: string; referrer_venue_id: string } | null = null;
    if (!salesForSession && referralProgrammeEnabled() && rawReferralCode) {
      const validation = await validateReferralCode(admin, rawReferralCode);
      if (validation.ok) {
        referralForSession = {
          code: validation.value.code,
          referrer_venue_id: validation.value.referrer_venue_id,
        };
      } else {
        console.log('[create-checkout] referral code dropped:', validation.reason);
      }
    }

    const sessionMetadata: Record<string, string> = {
      supabase_user_id: user.id,
      user_id: user.id,
      business_type,
      plan,
      pricing_tier: plan,
      calendar_count: String(quantity),
      booking_model: config.model,
      business_category: config.category,
    };
    if (salesForSession) {
      sessionMetadata.sales_code = salesForSession.code;
      sessionMetadata.salesperson_id = salesForSession.salesperson_id;
    } else if (referralForSession) {
      sessionMetadata.referral_code = referralForSession.code;
      sessionMetadata.referrer_venue_id = referralForSession.referrer_venue_id;
    }

    const subscriptionData = salesForSession
      ? buildSignupCheckoutSubscriptionDataWithSales(salesForSession.trial_days)
      : referralForSession
        ? buildSignupCheckoutSubscriptionDataWithReferral()
        : buildSignupCheckoutSubscriptionData();
    // Mirror the code onto the subscription metadata (not just the session) so the first paid
    // invoice can self-heal attribution if the checkout.session.completed webhook is missed.
    if (salesForSession) {
      subscriptionData.metadata = {
        sales_code: salesForSession.code,
        salesperson_id: salesForSession.salesperson_id,
      };
    } else if (referralForSession) {
      subscriptionData.metadata = {
        referral_code: referralForSession.code,
        referrer_venue_id: referralForSession.referrer_venue_id,
      };
    }

    const session = await stripe.checkout.sessions.create({
      customer: customer.id,
      mode: 'subscription',
      allow_promotion_codes: true,
      payment_method_collection: 'always',
      line_items: lineItems,
      subscription_data: subscriptionData,
      metadata: sessionMetadata,
      success_url: `${origin}/signup/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/signup/payment`,
    });

    return NextResponse.json({ redirect_url: session.url });
  } catch (err) {
    const stripeMessage =
      err &&
      typeof err === 'object' &&
      'type' in err &&
      (err as { type?: string }).type === 'StripeInvalidRequestError' &&
      'message' in err &&
      typeof (err as { message?: unknown }).message === 'string'
        ? (err as { message: string }).message
        : null;
    console.error('[create-checkout] Error:', err);
    if (stripeMessage) {
      return NextResponse.json({ error: stripeMessage }, { status: 400 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
