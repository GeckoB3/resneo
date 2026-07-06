import type { SupabaseClient } from '@supabase/supabase-js';

export type StripeWebhookClaimResult = 'claimed' | 'already_processed' | 'concurrent';

/**
 * How long a claimed-but-not-completed event is considered in-flight before a
 * redelivery may reclaim it. Real processing takes seconds; this is generous so
 * a slow-but-live worker is never reclaimed out from under, while a crashed
 * claim (no error handler ran, so the row was never released) is still retried
 * rather than silently dropped.
 */
const STALE_CLAIM_MS = 15 * 60 * 1000;

/**
 * Claim a Stripe webhook event for processing.
 *
 * Completion is tracked by `completed_at`, stamped by
 * `markStripeWebhookEventProcessed` only when processing SUCCEEDS. The row's
 * mere existence is NOT "processed": a claim whose worker died leaves
 * `completed_at` null, and once its claim (`processed_at`) is stale a
 * redelivery reclaims and reprocesses it.
 *
 * - `already_processed`: a prior run completed (completed_at set).
 * - `concurrent`: another worker holds a fresh claim; caller should 500 so
 *   Stripe retries later.
 * - `claimed`: caller owns processing and must call
 *   `markStripeWebhookEventProcessed` on success / `releaseStripeWebhookEvent`
 *   on failure.
 */
export async function claimStripeWebhookEvent(
  supabase: SupabaseClient,
  stripeEventId: string,
  eventType: string,
  logPrefix = '[Stripe webhook]',
): Promise<StripeWebhookClaimResult> {
  const { data: existing, error: selectError } = await supabase
    .from('webhook_events')
    .select('id, completed_at, processed_at')
    .eq('stripe_event_id', stripeEventId)
    .maybeSingle();

  if (selectError) {
    console.error(`${logPrefix} Failed to check event idempotency:`, selectError);
    throw selectError;
  }

  if (existing) {
    const row = existing as { completed_at: string | null; processed_at: string | null };
    if (row.completed_at) return 'already_processed';

    // Uncompleted claim: reclaim only if it is stale (its worker likely died).
    const claimedAtMs = row.processed_at ? Date.parse(row.processed_at) : Number.NaN;
    const isStale = Number.isFinite(claimedAtMs) && Date.now() - claimedAtMs > STALE_CLAIM_MS;
    if (!isStale) return 'concurrent';

    // Conditional reclaim: only wins if the row is still uncompleted and no one
    // else re-stamped the claim first (guards against two redeliveries racing).
    const { data: reclaimed, error: reclaimError } = await supabase
      .from('webhook_events')
      .update({ processed_at: new Date().toISOString() })
      .eq('stripe_event_id', stripeEventId)
      .is('completed_at', null)
      .eq('processed_at', row.processed_at as string)
      .select('id');
    if (reclaimError) {
      console.error(`${logPrefix} Failed to reclaim stale event:`, reclaimError);
      throw reclaimError;
    }
    return reclaimed && reclaimed.length > 0 ? 'claimed' : 'concurrent';
  }

  const { error: insertError } = await supabase.from('webhook_events').insert({
    stripe_event_id: stripeEventId,
    event_type: eventType,
    completed_at: null,
  });

  if (!insertError) return 'claimed';

  const code = (insertError as { code?: string }).code;
  if (code === '23505' || code === '409') {
    return 'concurrent';
  }

  console.error(`${logPrefix} Failed to claim event idempotency lock:`, insertError);
  throw insertError;
}

/**
 * Mark a claimed event as successfully completed. Must be called after
 * processing succeeds so a redelivery is recognised as `already_processed`.
 */
export async function markStripeWebhookEventProcessed(
  supabase: SupabaseClient,
  stripeEventId: string,
  logPrefix = '[Stripe webhook]',
): Promise<void> {
  const { error } = await supabase
    .from('webhook_events')
    .update({ completed_at: new Date().toISOString() })
    .eq('stripe_event_id', stripeEventId)
    .is('completed_at', null);

  if (error) {
    // Non-fatal: the state changes are already committed. A missed completion
    // stamp only risks a redelivery being reprocessed (handlers are
    // idempotent) after the stale window; better than failing the response.
    console.error(`${logPrefix} Failed to mark event completed:`, error);
  }
}

/** Release a failed claim so Stripe retries can re-process the event. */
export async function releaseStripeWebhookEvent(
  supabase: SupabaseClient,
  stripeEventId: string,
  logPrefix = '[Stripe webhook]',
): Promise<void> {
  const { error } = await supabase
    .from('webhook_events')
    .delete()
    .eq('stripe_event_id', stripeEventId);

  if (error) {
    console.error(`${logPrefix} Failed to release event idempotency lock:`, error);
  }
}
