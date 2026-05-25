import { NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { parseMembershipRules } from '@/lib/class-commerce/product-schemas';
import {
  extraVenueIdsFromUrl,
  getClassCommerceVenuesForUser,
} from '@/lib/class-commerce/user-venue-scope';

interface MembershipRowDb {
  id: string;
  venue_id: string;
  product_id: string;
  status: string;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  stripe_subscription_id: string | null;
  created_at: string;
}

interface ProductRowDb {
  id: string;
  name: string;
  venue_id: string;
  rules: Record<string, unknown>;
}

interface AllowanceLedgerRowDb {
  membership_id: string;
  delta_sessions: number;
  reason: string;
  created_at: string;
}

/** GET /api/account/memberships */
export async function GET(request: Request) {
  try {
    const supabase = await createRouteHandlerClient(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

    const admin = getSupabaseAdminClient();
    const { data: memberships, error: mErr } = await admin
      .from('class_memberships')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (mErr) {
      console.error('[account/memberships]', mErr);
      return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
    }

    const rows = (memberships ?? []) as MembershipRowDb[];
    const productIds = [...new Set(rows.map((r) => r.product_id))];
    const venueIds = [...new Set(rows.map((r) => r.venue_id))];

    const [{ data: products }, { data: venues }] = await Promise.all([
      productIds.length
        ? admin.from('class_membership_products').select('id, name, venue_id, rules').in('id', productIds)
        : Promise.resolve({ data: [] as unknown[] }),
      venueIds.length ? admin.from('venues').select('id, name').in('id', venueIds) : Promise.resolve({ data: [] as unknown[] }),
    ]);

    const productById = new Map(
      ((products ?? []) as ProductRowDb[]).map((p) => [p.id, p] as const),
    );

    // Pull all relevant allowance ledger rows for memberships with allowance plans.
    const allowanceMembershipIds = rows
      .filter((m) => {
        const prod = productById.get(m.product_id);
        if (!prod) return false;
        const rules = parseMembershipRules(prod.rules);
        return !rules.unlimited && (rules.allowance_per_period ?? 0) > 0;
      })
      .map((m) => m.id);

    let ledgerByMembership = new Map<string, AllowanceLedgerRowDb[]>();
    if (allowanceMembershipIds.length > 0) {
      const { data: ledger } = await admin
        .from('class_membership_allowance_ledger')
        .select('membership_id, delta_sessions, reason, created_at')
        .in('membership_id', allowanceMembershipIds)
        .order('created_at', { ascending: false })
        .limit(5000);
      ledgerByMembership = new Map();
      for (const r of (ledger ?? []) as AllowanceLedgerRowDb[]) {
        const arr = ledgerByMembership.get(r.membership_id) ?? [];
        arr.push(r);
        ledgerByMembership.set(r.membership_id, arr);
      }
    }

    function computeAllowanceStatus(m: MembershipRowDb) {
      const prod = productById.get(m.product_id);
      if (!prod) return null;
      const rules = parseMembershipRules(prod.rules);
      if (rules.unlimited) return { unlimited: true as const };
      const allowance = rules.allowance_per_period ?? 0;
      if (allowance <= 0) return null;

      const periodStart = m.current_period_start;
      const rowsForM = ledgerByMembership.get(m.id) ?? [];
      const inPeriod = periodStart
        ? rowsForM.filter((r) => r.created_at >= periodStart)
        : rowsForM;
      const resetRow = inPeriod.find((r) => r.reason === 'period_reset');
      const carryOver = resetRow?.delta_sessions ?? 0;
      let consumed = 0;
      for (const r of inPeriod) {
        if (r.reason === 'period_reset') continue;
        consumed -= r.delta_sessions;
      }
      const startingBalance = allowance + (rules.rollover ? carryOver : 0);
      const remaining = Math.max(0, startingBalance - Math.max(0, consumed));
      const used = Math.max(0, Math.min(startingBalance, Math.max(0, consumed)));
      return {
        unlimited: false as const,
        allowance_per_period: allowance,
        starting_balance: startingBalance,
        used,
        remaining,
        rollover: Boolean(rules.rollover),
        rollover_limit: rules.rollover_limit ?? null,
      };
    }

    const enriched = rows.map((m) => ({
      ...m,
      allowance_status: computeAllowanceStatus(m),
    }));

    // Phase 3 §6.4 — scope the purchase catalog to venues the user has touched,
    // plus any venue passed via `?venue=` deep-link.
    const scopedVenueIds = await getClassCommerceVenuesForUser(
      admin,
      user.id,
      extraVenueIdsFromUrl(request.url),
    );

    const { data: catalogProducts, error: catErr } =
      scopedVenueIds.length > 0
        ? await admin
            .from('class_membership_products')
            .select('id, name, venue_id, currency, stripe_price_id')
            .eq('active', true)
            .not('stripe_price_id', 'is', null)
            .in('venue_id', scopedVenueIds)
            .order('name', { ascending: true })
            .limit(200)
        : { data: [] as unknown[], error: null };

    if (catErr) {
      console.error('[account/memberships] catalog', catErr);
    }

    const pRows = (catalogProducts ?? []) as Array<{ venue_id: string }>;
    const catalogVenueIds = [...new Set(pRows.map((r) => r.venue_id))];
    const { data: catalogVenues } =
      catalogVenueIds.length > 0
        ? await admin.from('venues').select('id, name').in('id', catalogVenueIds).order('name')
        : { data: [] as unknown[] };

    return NextResponse.json({
      memberships: enriched,
      products: products ?? [],
      venues: venues ?? [],
      purchase_catalog: {
        venues: catalogVenues ?? [],
        products: catalogProducts ?? [],
      },
    });
  } catch (e) {
    console.error('[account/memberships] GET', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
