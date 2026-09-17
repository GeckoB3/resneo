import type { SupabaseClient } from '@supabase/supabase-js';
import { escapeLikePattern } from '@/lib/db/like-escape';

export interface ExistingVenueRow {
  venue_id: string;
  pricing_tier: string | null;
  active_booking_models?: unknown;
  onboarding_completed?: boolean | null;
}

/**
 * Whether the user already OWNS a venue (is an active admin), returning that venue's tier.
 *
 * Scoped to active admin rows: a person who is only non-admin staff at someone else's
 * venue does not own one and must still be able to create their own via /signup. Ordered
 * for a deterministic pick when a user admins more than one venue.
 */
export async function getExistingVenueForUserEmail(
  admin: SupabaseClient,
  email: string | null | undefined,
): Promise<ExistingVenueRow | null> {
  const normalized = (email ?? '').toLowerCase().trim();
  if (!normalized) return null;

  const { data: staffRows, error: staffErr } = await admin
    .from('staff')
    .select('venue_id')
    .ilike('email', escapeLikePattern(normalized))
    .eq('role', 'admin')
    .is('revoked_at', null)
    .order('venue_id', { ascending: true })
    .limit(1);

  if (staffErr || !staffRows?.length) return null;

  const venueId = staffRows[0]!.venue_id as string;
  const { data: venue, error: venueErr } = await admin
    .from('venues')
    .select('pricing_tier, active_booking_models, onboarding_completed')
    .eq('id', venueId)
    .maybeSingle();

  if (venueErr || !venue) return null;

  return {
    venue_id: venueId,
    pricing_tier: (venue as { pricing_tier?: string | null }).pricing_tier ?? null,
    active_booking_models: (venue as { active_booking_models?: unknown }).active_booking_models,
    onboarding_completed: (venue as { onboarding_completed?: boolean | null }).onboarding_completed ?? null,
  };
}

/**
 * Whether this login holds an unrevoked staff row at any venue, whatever its role.
 *
 * Signup would add an admin row at a new venue, and a login with unrevoked rows at two
 * venues cannot open either dashboard (resolveUniqueStaffRow refuses to choose, D38).
 * So a team member elsewhere is refused before Stripe checkout, and the two paid
 * provisioning paths (/api/signup/complete and the subscription webhook) never read such
 * a row as "this signup is already provisioned". Revoked rows do not count: a former
 * team member can sign up for their own business.
 *
 * Matches by email and by auth user id, as staffMembershipElsewhere does for invites,
 * because a claimed row's email can be stale. Throws on a lookup error so callers fail
 * closed rather than send someone to checkout.
 */
export async function hasUnrevokedStaffMembership(
  admin: SupabaseClient,
  userId: string | null | undefined,
  email: string | null | undefined,
): Promise<boolean> {
  const normalised = (email ?? '').toLowerCase().trim();
  const [byEmail, byUser] = await Promise.all([
    normalised
      ? admin
          .from('staff')
          .select('id', { count: 'exact', head: true })
          .ilike('email', escapeLikePattern(normalised))
          .is('revoked_at', null)
      : Promise.resolve({ count: 0, error: null }),
    userId
      ? admin
          .from('staff')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId)
          .is('revoked_at', null)
      : Promise.resolve({ count: 0, error: null }),
  ]);
  if (byEmail.error || byUser.error) {
    throw new Error(
      `staff membership lookup failed: ${(byEmail.error ?? byUser.error)?.message ?? 'unknown'}`,
    );
  }
  return (byEmail.count ?? 0) > 0 || (byUser.count ?? 0) > 0;
}

/** Shown before checkout when the signing-up email already works at a venue (D38). */
export function signupEmailIsTeamMemberMessage(email: string): string {
  return `${email} is already a team member at a ResNeo venue. To create your own business, sign up with a different email address.`;
}

/**
 * Shown after a paid checkout that could not be provisioned because the email works at a
 * venue. Only reachable if the person joined a team between checkout and completion, or
 * paid before the checkout refusal existed.
 */
export function signupPaidTeamMemberMessage(email: string): string {
  return `${email} is already a team member at a ResNeo venue, so we could not set up a new business with it. Please email support@resneo.com and we will cancel this subscription for you.`;
}
