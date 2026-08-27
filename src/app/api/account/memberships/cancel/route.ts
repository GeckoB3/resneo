import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createRouteHandlerClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { stripe } from '@/lib/stripe';

const bodySchema = z.object({
  membership_id: z.string().uuid(),
});

/**
 * POST /api/account/memberships/cancel — schedule cancel at period end on Stripe (connected account).
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createRouteHandlerClient(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorised', code: 'UNAUTHENTICATED' }, { status: 401 });

    const json = await request.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    const admin = getSupabaseAdminClient();
    const { data: row, error: fErr } = await admin
      .from('class_memberships')
      .select('id, venue_id, user_id, stripe_subscription_id')
      .eq('id', parsed.data.membership_id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (fErr || !row) {
      return NextResponse.json({ error: 'Membership not found' }, { status: 404 });
    }

    const subId = (row as { stripe_subscription_id?: string | null }).stripe_subscription_id?.trim();
    if (!subId) {
      return NextResponse.json({ error: 'No Stripe subscription linked yet' }, { status: 400 });
    }

    const { data: venue } = await admin
      .from('venues')
      .select('stripe_connected_account_id')
      .eq('id', (row as { venue_id: string }).venue_id)
      .maybeSingle();

    const acct = (venue as { stripe_connected_account_id?: string | null } | null)?.stripe_connected_account_id?.trim();
    if (!acct) {
      return NextResponse.json({ error: 'Venue Stripe account missing' }, { status: 400 });
    }

    await stripe.subscriptions.update(subId, { cancel_at_period_end: true }, { stripeAccount: acct });

    await admin
      .from('class_memberships')
      .update({
        cancel_at_period_end: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', parsed.data.membership_id);

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[account/memberships/cancel]', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
