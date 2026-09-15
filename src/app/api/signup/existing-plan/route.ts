import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import {
  getExistingVenueForUserEmail,
  hasUnrevokedStaffMembership,
  signupEmailIsTeamMemberMessage,
} from '@/lib/signup-existing-venue';
import { pricingTierToSignupFamily } from '@/lib/signup-plan-family';

/**
 * GET — whether the current user already has a venue (staff row). Used by the signup funnel UI.
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ hasVenue: false });
    }

    const admin = getSupabaseAdminClient();
    const existing = await getExistingVenueForUserEmail(admin, user.email);

    if (!existing) {
      // Staff at a venue they do not own: checkout will refuse (D38), so say so up front.
      if (await hasUnrevokedStaffMembership(admin, user.id, user.email)) {
        return NextResponse.json({
          hasVenue: false,
          teamMember: true,
          message: signupEmailIsTeamMemberMessage((user.email ?? '').trim().toLowerCase()),
        });
      }
      return NextResponse.json({ hasVenue: false });
    }

    const planFamily = pricingTierToSignupFamily(existing.pricing_tier);

    return NextResponse.json({
      hasVenue: true,
      pricing_tier: existing.pricing_tier,
      planFamily,
      onboarding_completed: existing.onboarding_completed === true,
    });
  } catch (err) {
    console.error('[signup/existing-plan] GET failed:', err);
    return NextResponse.json({ hasVenue: false });
  }
}
