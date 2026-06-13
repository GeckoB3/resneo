import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff, requireAdmin } from '@/lib/venue-auth';
import { stripe } from '@/lib/stripe';
import {
  subscriptionPeriodEndIso,
  subscriptionPeriodStartIso,
  subscriptionStatus,
} from '@/lib/stripe/subscription-fields';

interface VenueCancelRow {
  id: string;
  stripe_subscription_id: string | null;
  deletion_scheduled_at: string | null;
}

/** POST /api/venue/delete-request/cancel — abort a scheduled venue deletion (admin only). */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    if (!requireAdmin(staff)) return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 });

    const { data, error: vErr } = await staff.db
      .from('venues')
      .select('id, stripe_subscription_id, deletion_scheduled_at')
      .eq('id', staff.venue_id)
      .maybeSingle();
    if (vErr || !data) return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
    const venue = data as VenueCancelRow;

    if (!venue.deletion_scheduled_at) {
      return NextResponse.json({ error: 'No deletion is scheduled.' }, { status: 400 });
    }

    // Undo the cancel-at-period-end we set on request so the venue keeps running. Best-effort.
    // (If the venue had independently cancelled its plan before requesting deletion, this resumes
    //  it — a rare edge they can re-cancel via Plan → Cancel.)
    const subId = venue.stripe_subscription_id?.trim();
    if (subId) {
      try {
        const sub = await stripe.subscriptions.update(subId, { cancel_at_period_end: false });
        const st = subscriptionStatus(sub);
        await staff.db
          .from('venues')
          .update({
            plan_status: st === 'trialing' ? 'trialing' : 'active',
            subscription_current_period_start: subscriptionPeriodStartIso(sub),
            subscription_current_period_end: subscriptionPeriodEndIso(sub),
          })
          .eq('id', venue.id);
      } catch (e) {
        console.error('[venue/delete-request/cancel] stripe resume:', e instanceof Error ? e.message : e);
      }
    }

    const { error: updErr } = await staff.db
      .from('venues')
      .update({
        deletion_scheduled_at: null,
        deletion_requested_at: null,
        deletion_requested_by: null,
        deletion_requested_by_email: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', venue.id);

    if (updErr) {
      console.error('[venue/delete-request/cancel] clear:', updErr.message);
      return NextResponse.json({ error: 'Failed to cancel deletion' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[venue/delete-request/cancel]', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
