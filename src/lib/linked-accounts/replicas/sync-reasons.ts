/**
 * Why an update did not reach a venue, in the host's words (UX spec `sync.reason.*`).
 *
 * One mapping for the save summary, the "What needs you" strip and the failure notice (N5), so a
 * host never reads a technical code and never reads two different explanations of the same failure.
 * Anything not listed stays deliberately vague rather than technical.
 */
import { collectiveCopy } from '@/lib/linked-accounts/collective-copy';

export function syncFailureReason(code: string | null | undefined, venueName: string): string {
  if (code === 'lock_timeout' || code === 'timeout' || code === '55P03' || code === 'busy') {
    return collectiveCopy('sync.reason.busy', { venue: venueName });
  }
  if (code === 'membership_suspended' || code === 'subscription_lapsed') {
    return collectiveCopy('sync.reason.subscription', { venue: venueName });
  }
  return collectiveCopy('sync.reason.unknown');
}
