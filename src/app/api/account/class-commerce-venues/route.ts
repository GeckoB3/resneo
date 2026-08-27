import { NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase';

/**
 * GET /api/account/class-commerce-venues — venues where the user has credits, course enrollments, or memberships.
 * Used to pick a venue for per-venue saved payment methods.
 */
export async function GET(request: Request) {
  try {
    const supabase = await createRouteHandlerClient(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorised', code: 'UNAUTHENTICATED' }, { status: 401 });

    const admin = getSupabaseAdminClient();
    const [bal, enr, mem] = await Promise.all([
      admin.from('user_class_credit_balances').select('venue_id').eq('user_id', user.id),
      admin.from('class_course_enrollments').select('venue_id').eq('user_id', user.id),
      admin.from('class_memberships').select('venue_id').eq('user_id', user.id),
    ]);

    const ids = new Set<string>();
    for (const r of bal.data ?? []) ids.add((r as { venue_id: string }).venue_id);
    for (const r of enr.data ?? []) ids.add((r as { venue_id: string }).venue_id);
    for (const r of mem.data ?? []) ids.add((r as { venue_id: string }).venue_id);

    const venueIds = [...ids];
    if (venueIds.length === 0) {
      return NextResponse.json({ venues: [] });
    }

    const { data: venues, error } = await admin.from('venues').select('id, name').in('id', venueIds).order('name');

    if (error) {
      console.error('[account/class-commerce-venues]', error);
      return NextResponse.json({ error: 'Failed to load venues' }, { status: 500 });
    }

    return NextResponse.json({ venues: venues ?? [] });
  } catch (e) {
    console.error('[account/class-commerce-venues]', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
