/** Cookie persisted when a prospect follows a salesperson link. */
export const SALES_CODE_COOKIE_NAME = 'reserveni_sales';

/** Extend standard signup trial by this many days when a sales code is applied. */
export const SALES_REFEREE_BONUS_DAYS = 14;

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
