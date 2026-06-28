/** Cookie persisted when a prospect follows a salesperson link. */
export const SALES_CODE_COOKIE_NAME = 'reserveni_sales';

/** Companion cookie holding the validated free-trial length (days) of the active sales code. Display-only — the authoritative value is re-read from the code at checkout. */
export const SALES_TRIAL_COOKIE_NAME = 'reserveni_sales_trial';

/**
 * Default free trial for a commissioned-sales signup: one month free instead of the standard
 * 14-day trial (`SIGNUP_TRIAL_DAYS`). Individual sales codes can override this with their own
 * `trial_days` (see the `sales_codes` table), so a salesperson can offer 1 month, 2 months, or a
 * custom length per code. Applied as a flat Stripe `trial_period_days` on the sales-code checkout
 * — it replaces the standard trial, it is not added on top of it.
 */
export const SALES_SIGNUP_TRIAL_DAYS = 30;

/** A sales code always grants at least Stripe's minimum trial; the upper bound stops typos minting a multi-year free ride. */
export const MIN_SALES_TRIAL_DAYS = 1;
export const MAX_SALES_TRIAL_DAYS = 365;

/** Quick-pick trial presets (days) surfaced in the superuser code editor. */
export const SALES_TRIAL_PRESETS: ReadonlyArray<{ label: string; days: number }> = [
  { label: '14 days (standard)', days: 14 },
  { label: '1 month', days: 30 },
  { label: '2 months', days: 60 },
  { label: '3 months', days: 90 },
  { label: '6 months', days: 180 },
];

/** Coerce arbitrary input into a valid trial-day count, falling back to the default when unusable. */
export function clampSalesTrialDays(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return SALES_SIGNUP_TRIAL_DAYS;
  const rounded = Math.round(value);
  if (rounded < MIN_SALES_TRIAL_DAYS) return MIN_SALES_TRIAL_DAYS;
  if (rounded > MAX_SALES_TRIAL_DAYS) return MAX_SALES_TRIAL_DAYS;
  return rounded;
}

/**
 * Friendly headline for a code's free-trial reward — "1 month free", "2 months free",
 * "3 weeks free", or "45 days free". Pure (no imports) so it is safe on client and server.
 */
export function salesTrialRewardLabel(days: number): string {
  if (days > 0 && days % 30 === 0) {
    const months = days / 30;
    return `${months} month${months === 1 ? '' : 's'} free`;
  }
  if (days > 0 && days % 7 === 0) {
    const weeks = days / 7;
    return `${weeks} week${weeks === 1 ? '' : 's'} free`;
  }
  return `${days} days free`;
}

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
