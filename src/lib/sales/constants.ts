/** Cookie persisted when a prospect follows a salesperson link. */
export const SALES_CODE_COOKIE_NAME = 'reserveni_sales';

/**
 * Commissioned-sales signups get one month free instead of the standard 14-day trial
 * (`SIGNUP_TRIAL_DAYS`). Applied as a flat Stripe `trial_period_days` on the sales-code
 * checkout — it replaces the standard trial, it is not added on top of it.
 */
export const SALES_SIGNUP_TRIAL_DAYS = 30;

/** Default revenue-share window (months from first paid invoice). */
export const DEFAULT_REVENUE_SHARE_MONTHS = 12;

/** Default bonus ladder: threshold active paying subscribers → one-time bonus (pence). */
export const DEFAULT_SALES_BONUS_TIERS: ReadonlyArray<{ threshold: number; amount_pence: number }> = [
  { threshold: 25, amount_pence: 25_000 },
  { threshold: 50, amount_pence: 50_000 },
  { threshold: 75, amount_pence: 75_000 },
  { threshold: 100, amount_pence: 100_000 },
];

export const SALES_AGENT_KEY = 'sales_agent';
export const SALES_AGENT_VALUE = true;
export const SALES_AGENT_REGISTERED_KEY = 'sales_agent_registered';

export function salesProgrammeEnabled(): boolean {
  const raw = process.env.SALES_PROGRAMME_ENABLED;
  if (raw === undefined || raw === '') return true;
  return raw.toLowerCase() !== 'false' && raw !== '0';
}

/** Paying subscribers only — excludes trialing venues. */
export const ACTIVE_SUBSCRIBER_PLAN_STATUS = 'active';
