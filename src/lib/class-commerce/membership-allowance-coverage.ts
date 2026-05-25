import type { SupabaseClient } from '@supabase/supabase-js';
import { creditsProductEligibleForClassType } from '@/lib/class-commerce/available-class-credits';
import { parseMembershipRules, type ClassMembershipRules } from '@/lib/class-commerce/product-schemas';

export type MembershipCoverageResult =
  | {
      ok: true;
      membershipId: string;
      productId: string;
      mode: 'unlimited' | 'allowance';
      allowanceRemaining?: number;
      rules: ClassMembershipRules;
    }
  | {
      ok: false;
      reason: 'no_membership' | 'wrong_class_type' | 'allowance_exhausted' | 'db_error';
    };

interface MembershipRow {
  id: string;
  product_id: string;
  current_period_start: string | null;
  current_period_end: string | null;
  status: string;
}

interface MembershipProductRow {
  id: string;
  active: boolean;
  rules: Record<string, unknown>;
}

interface AllowanceLedgerRow {
  delta_sessions: number;
  reason: string;
}

/**
 * Inclusive of `redeem`/`restore` rows since the most recent period boundary.
 * `period_reset` rows themselves are not double-counted (they record carry-over,
 * which we treat as starting balance for the next period).
 */
async function sumAllowanceConsumedThisPeriod(
  admin: SupabaseClient,
  membershipId: string,
  periodStartIso: string | null,
): Promise<{ ok: true; consumed: number; carryOver: number } | { ok: false }> {
  // First, find the most recent period_reset row at or after periodStartIso so that
  // its delta becomes our "starting carry-over" for the period.
  const sinceIso = periodStartIso ?? new Date(0).toISOString();

  const { data: resetRows, error: resetErr } = await admin
    .from('class_membership_allowance_ledger')
    .select('delta_sessions, created_at')
    .eq('membership_id', membershipId)
    .eq('reason', 'period_reset')
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(1);

  if (resetErr) {
    console.error('[membership-allowance-coverage] period_reset', resetErr);
    return { ok: false };
  }
  const carryOver = ((resetRows ?? [])[0] as { delta_sessions?: number } | undefined)?.delta_sessions ?? 0;

  const { data: rows, error } = await admin
    .from('class_membership_allowance_ledger')
    .select('delta_sessions, reason, created_at')
    .eq('membership_id', membershipId)
    .gte('created_at', sinceIso)
    .in('reason', ['redeem', 'restore', 'admin_adjust', 'payment_reversal']);

  if (error) {
    console.error('[membership-allowance-coverage] ledger', error);
    return { ok: false };
  }
  let consumed = 0;
  for (const r of (rows ?? []) as AllowanceLedgerRow[]) {
    // redeem rows are negative (-N), restore rows positive (+N).
    consumed -= r.delta_sessions; // sums to NET sessions consumed
  }
  return { ok: true, consumed: Math.max(0, consumed), carryOver };
}

/**
 * Returns the best matching membership for a class booking:
 *  - prefers `unlimited` (highest priority),
 *  - else picks the membership with the highest remaining allowance.
 *
 * Caller is responsible for invoking `consumeMembershipAllowanceForBooking` when
 * the chosen membership has `mode === 'allowance'`.
 */
export async function membershipCoversClassType(
  admin: SupabaseClient,
  params: { userId: string; venueId: string; classTypeId: string; partySize: number },
): Promise<MembershipCoverageResult> {
  const { userId, venueId, classTypeId, partySize } = params;

  const { data: memberships, error: mErr } = await admin
    .from('class_memberships')
    .select('id, product_id, current_period_start, current_period_end, status')
    .eq('user_id', userId)
    .eq('venue_id', venueId)
    .in('status', ['active', 'trialing']);

  if (mErr) {
    console.error('[membershipCoversClassType] memberships', mErr);
    return { ok: false, reason: 'db_error' };
  }

  const mRows = (memberships ?? []) as MembershipRow[];
  if (mRows.length === 0) return { ok: false, reason: 'no_membership' };

  const productIds = [...new Set(mRows.map((r) => r.product_id))];
  const { data: products, error: pErr } = await admin
    .from('class_membership_products')
    .select('id, active, rules')
    .in('id', productIds)
    .eq('active', true);

  if (pErr) {
    console.error('[membershipCoversClassType] products', pErr);
    return { ok: false, reason: 'db_error' };
  }

  const productById = new Map(
    ((products ?? []) as MembershipProductRow[]).map((p) => [p.id, p] as const),
  );

  let bestUnlimited: { membership: MembershipRow; rules: ClassMembershipRules } | null = null;
  type AllowanceCandidate = {
    membership: MembershipRow;
    rules: ClassMembershipRules;
    remaining: number;
  };
  let bestAllowance: AllowanceCandidate | null = null;
  let sawCoveringMembership = false;

  for (const m of mRows) {
    const prod = productById.get(m.product_id);
    if (!prod) continue;
    const rules = parseMembershipRules(prod.rules);
    if (!creditsProductEligibleForClassType(rules.eligible_class_type_ids ?? null, classTypeId)) {
      continue;
    }
    sawCoveringMembership = true;

    if (rules.unlimited) {
      bestUnlimited = { membership: m, rules };
      // Don't break — but unlimited is strictly best.
      continue;
    }

    if (rules.allowance_per_period && rules.allowance_per_period > 0) {
      const summary = await sumAllowanceConsumedThisPeriod(
        admin,
        m.id,
        m.current_period_start,
      );
      if (!summary.ok) return { ok: false, reason: 'db_error' };
      const startingBalance =
        (rules.allowance_per_period ?? 0) + (rules.rollover ? summary.carryOver : 0);
      const remaining = startingBalance - summary.consumed;
      if (remaining >= partySize) {
        if (!bestAllowance || remaining > bestAllowance.remaining) {
          bestAllowance = { membership: m, rules, remaining };
        }
      }
    }
  }

  if (bestUnlimited) {
    return {
      ok: true,
      membershipId: bestUnlimited.membership.id,
      productId: bestUnlimited.membership.product_id,
      mode: 'unlimited',
      rules: bestUnlimited.rules,
    };
  }
  if (bestAllowance) {
    return {
      ok: true,
      membershipId: bestAllowance.membership.id,
      productId: bestAllowance.membership.product_id,
      mode: 'allowance',
      allowanceRemaining: bestAllowance.remaining,
      rules: bestAllowance.rules,
    };
  }
  if (sawCoveringMembership) return { ok: false, reason: 'allowance_exhausted' };
  return { ok: false, reason: 'wrong_class_type' };
}
