import type { SupabaseClient } from '@supabase/supabase-js';
import { validateSalesCode } from '@/lib/sales/lookup';
import { salesProgrammeEnabled } from '@/lib/sales/constants';

interface AttachSalesAttributionParams {
  admin: SupabaseClient;
  salesCode: string | null | undefined;
  referredVenueId: string;
  /** New venue owner's email — used to block a salesperson self-attributing their own signups. */
  refereeEmail?: string | null;
  /** New venue owner's auth user id — the strongest self-attribution signal (email-independent). */
  refereeUserId?: string | null;
}

export async function attachSalesAttributionOnSignup(
  params: AttachSalesAttributionParams,
): Promise<void> {
  const { admin, salesCode, referredVenueId, refereeEmail, refereeUserId } = params;
  if (!salesCode) return;
  if (!salesProgrammeEnabled()) return;

  const { data: existing } = await admin
    .from('sales_attributions')
    .select('id, status')
    .eq('venue_id', referredVenueId)
    .maybeSingle();
  if (existing) {
    console.log('[sales/attach] attribution already exists for venue', {
      referredVenueId,
      status: (existing as { status?: string }).status,
    });
    return;
  }

  const validation = await validateSalesCode(admin, salesCode);
  if (!validation.ok) {
    console.warn('[sales/attach] sales code failed validation at venue creation', {
      referredVenueId,
      reason: validation.reason,
    });
    return;
  }

  // Anti-abuse: a salesperson must not earn commission by signing up with their own code.
  // The auth-user check is email-independent (a salesperson can't dodge it with a +alias);
  // the email check is a fallback for paths where the user id isn't available.
  if (refereeUserId && validation.value.salesperson_user_id === refereeUserId) {
    console.warn('[sales/attach] self-attribution blocked (referee is the salesperson account)', {
      referredVenueId,
      salespersonId: validation.value.salesperson_id,
    });
    return;
  }
  const refereeEmailNorm = (refereeEmail ?? '').trim().toLowerCase();
  if (refereeEmailNorm && validation.value.salesperson_email === refereeEmailNorm) {
    console.warn('[sales/attach] self-attribution blocked (referee email matches salesperson)', {
      referredVenueId,
      salespersonId: validation.value.salesperson_id,
    });
    return;
  }

  const now = new Date().toISOString();
  const { error: insErr } = await admin.from('sales_attributions').insert({
    salesperson_id: validation.value.salesperson_id,
    code: validation.value.code,
    venue_id: referredVenueId,
    signed_up_at: now,
    trial_bonus_applied_at: now,
    status: 'pending',
  });

  if (insErr) {
    const code = (insErr as { code?: string }).code;
    if (code === '23505' || /duplicate key/i.test(insErr.message ?? '')) {
      return;
    }
    console.error('[sales/attach] insert failed', {
      referredVenueId,
      salespersonId: validation.value.salesperson_id,
      error: insErr.message,
    });
  }
}
