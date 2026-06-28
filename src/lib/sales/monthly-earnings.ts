import type { SupabaseClient } from '@supabase/supabase-js';
import {
  computeMonthlyStatement,
  monthStartUtc,
  type BonusTierRow,
  type MonthlyStatementBreakdown,
  type SalespersonRow,
} from '@/lib/sales/earnings';

/** A finalised month, persisted by the cron into `sales_monthly_statements`. */
export interface PersistedStatement {
  period_month: string;
  signups_count: number;
  validated_count: number;
  lump_sum_pence: number;
  revenue_share_pence: number;
  bonus_pence: number;
  active_subscribers_end: number;
  total_pence: number;
}

/** The live, not-yet-finalised running total for the in-progress calendar month. */
export type CurrentMonthBreakdown = MonthlyStatementBreakdown & { period_month: string };

export interface MonthlyEarnings {
  current_month: CurrentMonthBreakdown;
  statements: PersistedStatement[];
}

const STATEMENT_COLUMNS =
  'period_month, signups_count, validated_count, lump_sum_pence, revenue_share_pence, bonus_pence, active_subscribers_end, total_pence';

/** How many trailing finalised months the dashboards display. */
const STATEMENT_HISTORY_LIMIT = 24;

function zeroBreakdown(): MonthlyStatementBreakdown {
  return {
    signups_count: 0,
    validated_count: 0,
    lump_sum_pence: 0,
    revenue_share_pence: 0,
    bonus_pence: 0,
    active_subscribers_end: 0,
    total_pence: 0,
    new_bonus_awards: [],
  };
}

/**
 * Per-month earnings for one salesperson, shared by the salesperson dashboard (`/sales`) and the
 * superuser view (`/super/salespeople`) so both render identical figures.
 *
 * `current_month` is a live running total for the in-progress calendar month, computed exactly as
 * the cron will when it finalises the month (lump sum + revenue share actually paid by subscribers
 * so far + any milestone bonus whose threshold is now crossed). It is never persisted here.
 * `statements` are the already-finalised months from `sales_monthly_statements`, newest first.
 */
export async function loadMonthlyEarnings({
  admin,
  salesperson,
  bonusTiers,
}: {
  admin: SupabaseClient;
  salesperson: SalespersonRow;
  bonusTiers: BonusTierRow[];
}): Promise<MonthlyEarnings> {
  const periodMonth = monthStartUtc(new Date());

  let breakdown: MonthlyStatementBreakdown;
  try {
    breakdown = await computeMonthlyStatement({ admin, salesperson, periodMonth, bonusTiers });
  } catch (e) {
    console.error('[sales/monthly-earnings] current month compute failed', e);
    breakdown = zeroBreakdown();
  }

  const { data: stmtRows } = await admin
    .from('sales_monthly_statements')
    .select(STATEMENT_COLUMNS)
    .eq('salesperson_id', salesperson.id)
    .order('period_month', { ascending: false })
    .limit(STATEMENT_HISTORY_LIMIT);

  const statements: PersistedStatement[] = (stmtRows ?? []).map((s) => {
    const row = s as PersistedStatement;
    return {
      // Postgres `date` comes back with a time component in some drivers; normalise to YYYY-MM-DD
      // so the shared month formatter renders it the same way on both dashboards.
      period_month: String(row.period_month).slice(0, 10),
      signups_count: row.signups_count,
      validated_count: row.validated_count,
      lump_sum_pence: row.lump_sum_pence,
      revenue_share_pence: row.revenue_share_pence,
      bonus_pence: row.bonus_pence,
      active_subscribers_end: row.active_subscribers_end,
      total_pence: row.total_pence,
    };
  });

  return {
    current_month: { ...breakdown, period_month: periodMonth },
    statements,
  };
}
