import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getVenueStaff, requireAdmin } from '@/lib/venue-auth';
import { featureFlagDisabledResponse } from '@/lib/feature-flags/http';
import { loadVenueFeatureFlags } from '@/lib/feature-flags/venue';
import { depositConfigSchema } from '@/types/config-schemas';

/** PATCH /api/venue/deposit-config - update deposit_config (admin only). */
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }
    if (!requireAdmin(staff)) {
      return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 });
    }

    const body = await request.json();
    const parsed = depositConfigSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const deposit_config = parsed.data;

    if (deposit_config.type === 'card_hold') {
      const { resolved } = await loadVenueFeatureFlags(staff.db, staff.venue_id);
      if (!resolved.card_hold_deposits) {
        return featureFlagDisabledResponse('card_hold_deposits');
      }
    }

    const { data: venue, error } = await staff.db
      .from('venues')
      .update({ deposit_config, updated_at: new Date().toISOString() })
      .eq('id', staff.venue_id)
      .select('deposit_config')
      .single();

    if (error) {
      console.error('PATCH /api/venue/deposit-config failed:', error);
      return NextResponse.json({ error: 'Failed to update deposit config' }, { status: 500 });
    }

    return NextResponse.json({ deposit_config: venue.deposit_config });
  } catch (err) {
    console.error('PATCH /api/venue/deposit-config failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
