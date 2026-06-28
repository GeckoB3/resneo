import type { SupabaseClient } from '@supabase/supabase-js';
import { clampSalesTrialDays } from '@/lib/sales/constants';

export interface ValidatedSalesCode {
  code: string;
  /** Free-trial days this specific code grants the subscriber (Stripe trial_period_days). */
  trial_days: number;
  salesperson_id: string;
  salesperson_name: string;
  salesperson_email: string | null;
  /** Auth user behind the salesperson — used to block self-attribution regardless of email. */
  salesperson_user_id: string | null;
}

export type SalesCodeValidationFailure =
  | 'not_found'
  | 'inactive'
  | 'salesperson_inactive'
  | 'invalid_input';

export type SalesCodeValidationResult =
  | { ok: true; value: ValidatedSalesCode }
  | { ok: false; reason: SalesCodeValidationFailure };

const CODE_PATTERN = /^[A-Z0-9-]{3,40}$/;

export function normaliseSalesCodeInput(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().toUpperCase();
  if (!trimmed) return null;
  if (!CODE_PATTERN.test(trimmed)) return null;
  return trimmed;
}

export async function validateSalesCode(
  admin: SupabaseClient,
  rawCode: string | null | undefined,
): Promise<SalesCodeValidationResult> {
  const normalised = normaliseSalesCodeInput(rawCode);
  if (!normalised) return { ok: false, reason: 'invalid_input' };

  const { data: codeRow, error: codeErr } = await admin
    .from('sales_codes')
    .select('code, active, salesperson_id, trial_days')
    .ilike('code', normalised)
    .maybeSingle();

  if (codeErr) {
    console.error('[sales/lookup] code lookup failed', { code: normalised, error: codeErr.message });
    return { ok: false, reason: 'not_found' };
  }
  if (!codeRow) return { ok: false, reason: 'not_found' };
  if (codeRow.active === false) return { ok: false, reason: 'inactive' };

  const { data: spRow, error: spErr } = await admin
    .from('salespeople')
    .select('id, name, email, user_id, active, revoked_at')
    .eq('id', codeRow.salesperson_id)
    .maybeSingle();

  if (spErr || !spRow) return { ok: false, reason: 'not_found' };
  if (spRow.revoked_at || spRow.active === false) {
    return { ok: false, reason: 'salesperson_inactive' };
  }

  return {
    ok: true,
    value: {
      code: codeRow.code,
      trial_days: clampSalesTrialDays((codeRow as { trial_days?: number | null }).trial_days),
      salesperson_id: spRow.id,
      salesperson_name: (spRow.name ?? '').trim() || 'ResNeo sales',
      salesperson_email: ((spRow as { email?: string | null }).email ?? '').trim().toLowerCase() || null,
      salesperson_user_id: (spRow as { user_id?: string | null }).user_id ?? null,
    },
  };
}
