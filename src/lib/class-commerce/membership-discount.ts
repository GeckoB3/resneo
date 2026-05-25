import type { SupabaseClient } from '@supabase/supabase-js';
import { creditsProductEligibleForClassType } from '@/lib/class-commerce/available-class-credits';
import { parseMembershipRules } from '@/lib/class-commerce/product-schemas';

/**
 * Best (highest) percent discount granted by any active/trialing membership
 * the user holds at `venueId` that covers `classTypeId`. 0 = no discount.
 */
export async function getMembershipDiscountForClassType(
  admin: SupabaseClient,
  params: { userId: string; venueId: string; classTypeId: string },
): Promise<number> {
  const { userId, venueId, classTypeId } = params;

  const { data: memberships, error: mErr } = await admin
    .from('class_memberships')
    .select('product_id')
    .eq('user_id', userId)
    .eq('venue_id', venueId)
    .in('status', ['active', 'trialing']);

  if (mErr) {
    console.error('[getMembershipDiscount] memberships', mErr);
    return 0;
  }
  const productIds = [
    ...new Set((memberships ?? []).map((r) => (r as { product_id: string }).product_id)),
  ];
  if (productIds.length === 0) return 0;

  const { data: products, error: pErr } = await admin
    .from('class_membership_products')
    .select('id, rules, active')
    .in('id', productIds)
    .eq('active', true);

  if (pErr) {
    console.error('[getMembershipDiscount] products', pErr);
    return 0;
  }

  let best = 0;
  for (const p of products ?? []) {
    const row = p as { rules: Record<string, unknown> };
    const rules = parseMembershipRules(row.rules);
    if (!creditsProductEligibleForClassType(rules.eligible_class_type_ids ?? null, classTypeId)) {
      continue;
    }
    const pct = rules.discount_percent ?? 0;
    if (pct > best) best = pct;
  }
  return Math.min(100, Math.max(0, best));
}

/**
 * True if the user has any active/trialing membership at this venue whose plan
 * has `allow_recurring: true`. Plan §4.5.3 gates `/api/account/class-recurring`
 * POST on this.
 */
export async function userVenueHasMembershipAllowingRecurring(
  admin: SupabaseClient,
  params: { userId: string; venueId: string },
): Promise<boolean> {
  const { userId, venueId } = params;
  const { data: memberships, error: mErr } = await admin
    .from('class_memberships')
    .select('product_id')
    .eq('user_id', userId)
    .eq('venue_id', venueId)
    .in('status', ['active', 'trialing']);

  if (mErr) {
    console.error('[userVenueHasMembershipAllowingRecurring] memberships', mErr);
    return false;
  }
  const productIds = [
    ...new Set((memberships ?? []).map((r) => (r as { product_id: string }).product_id)),
  ];
  if (productIds.length === 0) return false;

  const { data: products, error: pErr } = await admin
    .from('class_membership_products')
    .select('id, rules, active')
    .in('id', productIds)
    .eq('active', true);

  if (pErr) {
    console.error('[userVenueHasMembershipAllowingRecurring] products', pErr);
    return false;
  }

  for (const p of products ?? []) {
    const row = p as { rules: Record<string, unknown> };
    const rules = parseMembershipRules(row.rules);
    if (rules.allow_recurring) return true;
  }
  return false;
}
