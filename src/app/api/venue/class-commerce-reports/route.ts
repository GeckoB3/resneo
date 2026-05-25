import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getVenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { requireClassCommercePlan } from '@/lib/class-commerce/auth';

/**
 * GET /api/venue/class-commerce-reports — lightweight class-commerce KPIs for the dashboard.
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    const gate = await requireClassCommercePlan(staff.db, staff.venue_id);
    if (!gate.ok) return gate.response;

    const admin = getSupabaseAdminClient();
    const venueId = staff.venue_id;
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - 30);
    const sinceIso = since.toISOString();

    const [{ data: balances }, { data: txRows }] = await Promise.all([
      admin.from('user_class_credit_balances').select('credits_remaining').eq('venue_id', venueId),
      admin.from('class_checkout_transactions').select('amount_pence').eq('venue_id', venueId).gte('created_at', sinceIso),
    ]);

    const outstandingCredits = (balances ?? []).reduce(
      (s, r) => s + (r as { credits_remaining: number }).credits_remaining,
      0,
    );
    const checkoutPence30d = (txRows ?? []).reduce((s, r) => s + (r as { amount_pence: number }).amount_pence, 0);

    return NextResponse.json({
      venue_id: venueId,
      outstanding_credit_units: outstandingCredits,
      checkout_amount_pence_30d: checkoutPence30d,
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[venue/class-commerce-reports]', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
