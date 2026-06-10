import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff, requireAdmin } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import {
  clearCommunicationPoliciesCache,
  getVenueCommunicationPolicies,
  mergeCommunicationPoliciesPatch,
} from '@/lib/communications/policies';

export async function GET(request: Request) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }

    const policies = await getVenueCommunicationPolicies(staff.venue_id);
    return NextResponse.json(policies);
  } catch (error) {
    console.error('[communication-policies GET] failed:', error);
    return NextResponse.json(
      { error: 'Failed to load communication policies' },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!requireAdmin(staff)) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json();
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
    }

    const admin = getSupabaseAdminClient();
    const current = await getVenueCommunicationPolicies(staff.venue_id);
    const next = mergeCommunicationPoliciesPatch(current, body);

    const { error } = await admin
      .from('venues')
      .update({
        communication_policies: next as unknown as Record<string, never>,
      })
      .eq('id', staff.venue_id);

    if (error) {
      console.error('[communication-policies PUT] update failed:', error);
      return NextResponse.json(
        { error: 'Failed to update communication policies' },
        { status: 500 },
      );
    }

    clearCommunicationPoliciesCache(staff.venue_id);
    return NextResponse.json(next);
  } catch (error) {
    console.error('[communication-policies PUT] failed:', error);
    return NextResponse.json(
      { error: 'Failed to update communication policies' },
      { status: 500 },
    );
  }
}
