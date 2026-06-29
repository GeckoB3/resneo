import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff, requireAdmin } from '@/lib/venue-auth';
import { stripe } from '@/lib/stripe';
import { sanitizeAuthNextPath } from '@/lib/safe-auth-redirect';
import { z } from 'zod';

interface StripeConnectPostResponse {
  url: string;
}

interface StripeConnectGetResponse {
  connected: true;
  charges_enabled: boolean;
  details_submitted: boolean;
}

const postBodySchema = z
  .object({
    /** Same-origin path + optional query (e.g. /onboarding?stripe=success). Defaults to dashboard Settings → Payments. */
    return_path: z.string().optional(),
    refresh_path: z.string().optional(),
  })
  .optional();

/**
 * Turn a thrown error into an admin-facing message. Stripe surfaces actionable
 * config/credential problems (Connect not enabled, invalid/rotated API key,
 * unknown account, etc.) in `error.message`. These routes are operator-facing,
 * so showing the real reason beats a generic 500 that hides the cause.
 */
function describeStripeRouteError(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { type?: unknown; message?: unknown };
    if (
      typeof e.type === 'string' &&
      e.type.startsWith('Stripe') &&
      typeof e.message === 'string' &&
      e.message.trim()
    ) {
      return `Stripe error: ${e.message}`;
    }
  }
  return 'Internal server error';
}

/** POST /api/venue/stripe-connect - create or resume Stripe Connect onboarding. */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }
    if (!requireAdmin(staff)) {
      return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 });
    }

    let returnPath = '/dashboard/settings?stripe=success';
    let refreshPath = '/dashboard/settings?stripe=refresh';
    try {
      const json = await request.json().catch(() => ({}));
      const parsed = postBodySchema.safeParse(json);
      if (parsed.success && parsed.data) {
        const { return_path: ret, refresh_path: ref } = parsed.data;
        if (ret?.trim()) {
          returnPath = sanitizeAuthNextPath(ret.trim());
        }
        if (ref?.trim()) {
          refreshPath = sanitizeAuthNextPath(ref.trim());
        }
      }
    } catch {
      /* use defaults */
    }

    const { data: venue, error: fetchError } = await staff.db
      .from('venues')
      .select('stripe_connected_account_id')
      .eq('id', staff.venue_id)
      .single();

    if (fetchError || !venue) {
      console.error('POST /api/venue/stripe-connect - venue lookup failed:', fetchError);
      return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
    }

    let accountId: string = venue.stripe_connected_account_id ?? '';

    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        country: 'GB',
        // Stripe rejects an empty-string email (StripeInvalidRequestError: email_invalid).
        // Omit it when blank so onboarding still starts; Stripe will collect it.
        email: staff.email?.trim() || undefined,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
      });

      accountId = account.id;

      const { error: updateError } = await staff.db
        .from('venues')
        .update({
          stripe_connected_account_id: accountId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', staff.venue_id);

      if (updateError) {
        console.error('POST /api/venue/stripe-connect - failed to store account ID:', updateError);
        return NextResponse.json({ error: 'Failed to save Stripe account' }, { status: 500 });
      }
    }

    const origin = process.env.NEXT_PUBLIC_BASE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : request.nextUrl.origin);

    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${origin.replace(/\/$/, '')}${refreshPath}`,
      return_url: `${origin.replace(/\/$/, '')}${returnPath}`,
      type: 'account_onboarding',
    });

    return NextResponse.json({ url: accountLink.url } satisfies StripeConnectPostResponse);
  } catch (err) {
    console.error('POST /api/venue/stripe-connect failed:', err);
    return NextResponse.json({ error: describeStripeRouteError(err) }, { status: 500 });
  }
}

/** GET /api/venue/stripe-connect - check Stripe Connect account status. */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }

    const { data: venue, error: fetchError } = await staff.db
      .from('venues')
      .select('stripe_connected_account_id')
      .eq('id', staff.venue_id)
      .single();

    if (fetchError || !venue) {
      console.error('GET /api/venue/stripe-connect - venue lookup failed:', fetchError);
      return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
    }

    if (!venue.stripe_connected_account_id) {
      return NextResponse.json({ error: 'No Stripe account connected' }, { status: 404 });
    }

    const account = await stripe.accounts.retrieve(venue.stripe_connected_account_id);

    return NextResponse.json({
      connected: true,
      charges_enabled: account.charges_enabled ?? false,
      details_submitted: account.details_submitted ?? false,
    } satisfies StripeConnectGetResponse);
  } catch (err) {
    console.error('GET /api/venue/stripe-connect failed:', err);
    return NextResponse.json({ error: describeStripeRouteError(err) }, { status: 500 });
  }
}
