import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff, requireAdmin } from '@/lib/venue-auth';
import { stripe } from '@/lib/stripe';
import { normalizePublicBaseUrl } from '@/lib/public-base-url';

/**
 * POST /api/billing/portal-session
 * Creates a Stripe Customer Portal session for the venue billing customer.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff || !requireAdmin(staff)) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { data: venue, error } = await staff.db
      .from('venues')
      .select('stripe_customer_id')
      .eq('id', staff.venue_id)
      .maybeSingle();
    if (error || !venue) {
      return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
    }

    const customerId = String((venue as { stripe_customer_id?: string | null }).stripe_customer_id ?? '').trim();
    if (!customerId) {
      return NextResponse.json(
        { error: 'No Stripe billing customer is linked to this venue yet.' },
        { status: 400 },
      );
    }

    const origin = normalizePublicBaseUrl(process.env.NEXT_PUBLIC_BASE_URL);
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${origin}/dashboard/settings?tab=plan&portal_return=1`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error('[billing/portal-session] Error:', err);
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
