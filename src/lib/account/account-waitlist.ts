import type { SupabaseClient } from '@supabase/supabase-js';

export interface AccountWaitlistRow {
  id: string;
  venue_id: string;
  /** `table` or `appointment`. */
  waitlist_kind: string;
  /** `waiting`, `offered`, `confirmed`, `expired` or `cancelled`. */
  status: string;
  desired_date: string;
  desired_time: string | null;
  desired_time_end: string | null;
  /** When an offer was made, so the portal can say a place came up. */
  offered_at: string | null;
  /** When an offer lapses. Null unless one is open. */
  expires_at: string | null;
  created_at: string;
}

/**
 * What the customer sees of a waitlist entry.
 *
 * `guest_phone`, `guest_email` and `notes` are omitted: the first two the
 * customer already knows, and `notes` is free text they wrote which is
 * harmless but adds nothing, while every field returned is one more thing to
 * keep correct. `party_size` is always 1 for appointments.
 */
export const ACCOUNT_WAITLIST_COLUMNS =
  'id, venue_id, waitlist_kind, status, desired_date, desired_time, desired_time_end, offered_at, expires_at, created_at';

/**
 * Statuses a customer may still cancel.
 *
 * Cancelling an `expired` or already `cancelled` row would be a no-op dressed
 * as an action, and `confirmed` means the venue has turned it into a booking,
 * which is cancelled as a booking rather than here.
 */
export const CANCELLABLE_WAITLIST_STATUSES = ['waiting', 'offered'] as const;

/**
 * Waitlist entries belonging to the signed-in account.
 *
 * **Ownership is by EMAIL, and that is forced by the table rather than
 * chosen.** `waitlist_entries` has no `guest_id`: a waitlist entry is made
 * before there is any booking, often by somebody with no account at all, so
 * the only identity it carries is the address they typed. Both join routes
 * store it trimmed and lowercased, so matching the account's own verified
 * address is exact rather than fuzzy.
 *
 * Read as ADMIN because the table keeps exactly one RLS policy, for staff, and
 * a previous migration deliberately dropped the public ones. Adding a customer
 * policy would reverse that decision; scoping in the application is the same
 * shape AD8 uses for `booking_payments`.
 */
export async function loadAccountWaitlist(
  admin: SupabaseClient,
  accountEmail: string | null | undefined,
  opts: { limit?: number } = {},
): Promise<AccountWaitlistRow[]> {
  const email = accountEmail?.trim().toLowerCase();
  // No address means no way to prove ownership of anything, so nothing is
  // returned rather than an unfiltered read.
  if (!email) return [];

  const { data, error } = await admin
    .from('waitlist_entries')
    .select(ACCOUNT_WAITLIST_COLUMNS)
    .eq('guest_email', email)
    .order('desired_date', { ascending: true })
    .limit(opts.limit ?? 50);

  if (error) {
    console.error('[loadAccountWaitlist] read failed:', error.message);
    throw new Error('Failed to load waitlist entries');
  }
  return (data ?? []) as unknown as AccountWaitlistRow[];
}

export type WaitlistCancelResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'not_cancellable' | 'error' };

/**
 * Cancel one entry, if it is this account's to cancel.
 *
 * **The ownership check and the write are one statement**, filtered by id AND
 * email together. Reading the row first and then updating by id alone would
 * leave a window, however small, in which the row could change hands, and it
 * would put the rule in two places. A row that is not the caller's simply
 * matches nothing.
 */
export async function cancelAccountWaitlistEntry(
  admin: SupabaseClient,
  accountEmail: string | null | undefined,
  entryId: string,
): Promise<WaitlistCancelResult> {
  const email = accountEmail?.trim().toLowerCase();
  if (!email) return { ok: false, reason: 'not_found' };

  const { data, error } = await admin
    .from('waitlist_entries')
    .update({ status: 'cancelled' })
    .eq('id', entryId)
    .eq('guest_email', email)
    .in('status', [...CANCELLABLE_WAITLIST_STATUSES])
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('[cancelAccountWaitlistEntry] update failed:', error.message);
    return { ok: false, reason: 'error' };
  }
  if (data) return { ok: true };

  /*
    Nothing was updated, and the two reasons need telling apart for the
    CUSTOMER's sake, not the caller's: "you already cancelled that" is a
    different message from "we cannot find it". The extra read is scoped to
    this account's own rows, so it cannot be used to probe for anyone else's.
  */
  const { data: mine } = await admin
    .from('waitlist_entries')
    .select('id')
    .eq('id', entryId)
    .eq('guest_email', email)
    .maybeSingle();

  return { ok: false, reason: mine ? 'not_cancellable' : 'not_found' };
}
