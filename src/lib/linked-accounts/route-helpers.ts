/** Shared request-handling helpers for the Linked Accounts API routes. */

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createRouteHandlerClientFromHeaders } from '@/lib/supabase/server';
import { getVenueStaff, type VenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { checkRateLimit } from '@/lib/rate-limit';
import { evaluateLinkEligibility, type EligibilityResult } from './eligibility';

export interface LinkAdminContext {
  staff: VenueStaff;
  admin: SupabaseClient;
  venueId: string;
  venue: {
    id: string;
    name: string;
    slug: string;
    pricing_tier: string | null;
    plan_status: string | null;
    booking_model: string | null;
  };
  eligibility: EligibilityResult;
  /** Auth user id of the acting admin, for audit attribution. */
  userId: string | null;
}

type Resolution =
  | { ok: true; ctx: LinkAdminContext }
  | { ok: false; response: NextResponse };

/**
 * Per-venue fixed-window rate limit for Linked Accounts mutating + export routes
 * (§16.1 #9). Keyed on the venue id rather than IP so a venue can't sidestep the
 * limit by switching networks. Returns a 429 response when exceeded, else null.
 */
export function enforceLinkRateLimit(
  venueId: string,
  key: string,
  limit: number,
  windowMs: number,
): NextResponse | null {
  const r = checkRateLimit(venueId, `linked:${key}`, limit, windowMs);
  if (r.ok) return null;
  return NextResponse.json(
    { error: 'You’re doing that a lot. Please wait a moment and try again.' },
    { status: 429, headers: { 'Retry-After': String(r.retryAfterSec) } },
  );
}

/**
 * Resolve the authenticated venue admin for a Linked Accounts route. Link
 * management is restricted to Admin staff (§3.1).
 */
export async function resolveLinkAdmin(): Promise<Resolution> {
  const supabase = await createRouteHandlerClientFromHeaders();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const staff = await getVenueStaff(supabase);
  if (!staff) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorised' }, { status: 401 }) };
  }
  if (staff.role !== 'admin') {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Only venue admins can manage linked accounts.' },
        { status: 403 },
      ),
    };
  }

  const admin = getSupabaseAdminClient();
  const { data: venueRow, error } = await admin
    .from('venues')
    .select('id, name, slug, pricing_tier, plan_status, booking_model')
    .eq('id', staff.venue_id)
    .maybeSingle();

  if (error || !venueRow) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Venue not found' }, { status: 404 }),
    };
  }

  const venue = {
    id: venueRow.id as string,
    name: (venueRow.name as string) ?? 'Your venue',
    slug: (venueRow.slug as string) ?? '',
    pricing_tier: (venueRow.pricing_tier as string | null) ?? null,
    plan_status: (venueRow.plan_status as string | null) ?? null,
    booking_model: (venueRow.booking_model as string | null) ?? null,
  };
  const eligibility = evaluateLinkEligibility(venue);

  return {
    ok: true,
    ctx: {
      staff,
      admin,
      venueId: staff.venue_id,
      venue,
      eligibility,
      userId: user?.id ?? null,
    },
  };
}
