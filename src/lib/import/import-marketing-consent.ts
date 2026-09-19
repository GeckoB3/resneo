import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Marketing permission for the contacts an import brings in.
 *
 * The owner's rule (2026-09-19): an imported contact is taken to have agreed to
 * marketing unless the file says they have not. Without it every imported contact
 * landed with `marketing_consent = false`, so a bulk message from Contacts (which
 * needs consent recorded AND no opt-out, see `hasMarketingPermission`) skipped all
 * of them, even rows whose file said "Marketing consent: Yes".
 *
 * What counts as the file saying no, for one row:
 *  - a general marketing consent column answering no ("No", "False", "Opted out"...);
 *  - an opt-out column (`marketing_opt_out`: Unsubscribed, Do not contact...) answering yes;
 *  - an email or SMS marketing consent column answering no. A contact has one
 *    marketing switch, which covers every channel, so a no to either channel is
 *    taken as a no to marketing rather than risk sending on the channel they refused.
 * A blank cell, or an answer that is neither a clear yes nor a clear no, says
 * nothing, and the default applies.
 *
 * An import never overrides a choice made in ResNeo, except to opt someone out
 * when the file says so: it never re-subscribes a contact who opted out, and it
 * leaves alone a contact whose marketing choice is already on record.
 */

export type ImportMarketingAnswer = 'consent' | 'opt_out';

/** The mapped target fields that carry a marketing answer. */
export interface ImportMarketingTargets {
  marketing_consent?: string | null;
  email_marketing_consent?: string | null;
  sms_marketing_consent?: string | null;
  marketing_opt_out?: string | null;
}

export interface GuestMarketingColumns {
  marketing_consent: boolean;
  marketing_consent_at: string | null;
  marketing_opt_out: boolean;
}

/** Answers that mean the same whichever way round the column is asked. */
const STATUS_CONSENT = new Set([
  'subscribed',
  'opted in',
  'opt in',
  'consented',
  'consent given',
  'accepted',
  'agreed',
  'granted',
  'allowed',
]);
const STATUS_OPT_OUT = new Set([
  'unsubscribed',
  'not subscribed',
  'opted out',
  'opt out',
  'declined',
  'refused',
  'withdrawn',
  'denied',
  'do not contact',
  'do not market',
  'no marketing',
]);
/** Plain yes and no, read by the column's own question. */
const YES = new Set(['yes', 'y', 'true', 't', '1', 'on', 'ok', 'x']);
const NO = new Set(['no', 'n', 'false', 'f', '0', 'off', 'none']);

function normaliseAnswer(raw: string | null | undefined): string {
  return (raw ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * One cell's answer. `question` is what the column asks: `consent` for "did they
 * agree to marketing?", `opt_out` for "did they opt out?". So "Yes" in an
 * Unsubscribed column is an opt-out, while "Opted out" reads as an opt-out in
 * either kind of column.
 */
export function readMarketingAnswer(
  raw: string | null | undefined,
  question: 'consent' | 'opt_out',
): ImportMarketingAnswer | null {
  const t = normaliseAnswer(raw);
  if (!t) return null;
  if (STATUS_OPT_OUT.has(t)) return 'opt_out';
  if (STATUS_CONSENT.has(t)) return 'consent';
  if (YES.has(t)) return question === 'consent' ? 'consent' : 'opt_out';
  if (NO.has(t)) return question === 'consent' ? 'opt_out' : 'consent';
  return null;
}

/** The row's answer: any no wins over any yes; null when the row says nothing either way. */
export function fileMarketingAnswer(targets: ImportMarketingTargets): ImportMarketingAnswer | null {
  const answers = [
    readMarketingAnswer(targets.marketing_consent, 'consent'),
    readMarketingAnswer(targets.email_marketing_consent, 'consent'),
    readMarketingAnswer(targets.sms_marketing_consent, 'consent'),
    readMarketingAnswer(targets.marketing_opt_out, 'opt_out'),
  ];
  if (answers.includes('opt_out')) return 'opt_out';
  if (answers.includes('consent')) return 'consent';
  return null;
}

/** The marketing columns for a contact the import creates. */
export function marketingForNewImportedGuest(
  answer: ImportMarketingAnswer | null,
  nowIso: string,
): GuestMarketingColumns {
  if (answer === 'opt_out') {
    return { marketing_consent: false, marketing_consent_at: null, marketing_opt_out: true };
  }
  return { marketing_consent: true, marketing_consent_at: nowIso, marketing_opt_out: false };
}

/**
 * What an import changes on a contact it updates; `{}` leaves their marketing
 * as it is. `hasRecordedChoice` is true when a marketing choice for the contact
 * is already on record in ResNeo (any `guest_marketing_consent_events` row), which
 * an import must not override except to opt them out.
 */
export function marketingUpdateForExistingGuest(
  prev: { marketing_consent?: boolean | null; marketing_opt_out?: boolean | null },
  answer: ImportMarketingAnswer | null,
  opts: { hasRecordedChoice: boolean; nowIso: string },
): Partial<GuestMarketingColumns> {
  const consented = Boolean(prev.marketing_consent);
  const optedOut = Boolean(prev.marketing_opt_out);
  if (answer === 'opt_out') {
    if (optedOut && !consented) return {};
    return { marketing_consent: false, marketing_consent_at: null, marketing_opt_out: true };
  }
  if (optedOut || consented || opts.hasRecordedChoice) return {};
  return { marketing_consent: true, marketing_consent_at: opts.nowIso, marketing_opt_out: false };
}

/**
 * Where an import's undo record (`import_records.previous_data`) keeps what the
 * import changed about a contact's marketing, so undo can revert exactly that.
 */
export const IMPORT_MARKETING_CHANGE_KEY = 'import_marketing_change';

type MarketingNow = { marketing_consent?: boolean | null; marketing_opt_out?: boolean | null };

function marketingChangeIn(previous: Record<string, unknown>): Partial<GuestMarketingColumns> | null {
  const change = previous[IMPORT_MARKETING_CHANGE_KEY];
  if (!change || typeof change !== 'object') return null;
  return Object.keys(change).length > 0 ? (change as Partial<GuestMarketingColumns>) : null;
}

/** True when undo needs the contact's current marketing columns to decide (see `marketingRestoreForUndo`). */
export function undoNeedsCurrentMarketing(previous: Record<string, unknown>): boolean {
  return marketingChangeIn(previous) != null;
}

/**
 * What undo writes back about marketing for a contact the import updated; `{}`
 * leaves it as it is now.
 *  - A record from before the import kept its change: restore the opt-out, as undo always did.
 *  - The import changed nothing about marketing: leave it.
 *  - The import changed it and it still reads as the import left it: put back what was there.
 *  - Somebody changed it since, say an unsubscribe or a staff edit: theirs stands.
 */
export function marketingRestoreForUndo(
  previous: Record<string, unknown>,
  current: MarketingNow | null,
): Partial<GuestMarketingColumns> {
  if (!(IMPORT_MARKETING_CHANGE_KEY in previous)) {
    return { marketing_opt_out: Boolean(previous.marketing_opt_out) };
  }
  const change = marketingChangeIn(previous);
  if (!change || !current) return {};
  const stillAsImported =
    (change.marketing_consent === undefined || Boolean(current.marketing_consent) === change.marketing_consent) &&
    (change.marketing_opt_out === undefined || Boolean(current.marketing_opt_out) === change.marketing_opt_out);
  if (!stillAsImported) return {};
  return {
    marketing_consent: Boolean(previous.marketing_consent),
    marketing_consent_at: (previous.marketing_consent_at as string | null | undefined) ?? null,
    marketing_opt_out: Boolean(previous.marketing_opt_out),
  };
}

/**
 * Whether a marketing choice for the contact is already on record: staff changing
 * it, the client choosing on a booking page or in their account, an unsubscribe.
 * A failed lookup answers true, so an import never assumes consent it cannot check.
 */
export async function guestHasMarketingChoiceOnRecord(
  db: SupabaseClient,
  venueId: string,
  guestId: string,
): Promise<boolean> {
  const { data, error } = await db
    .from('guest_marketing_consent_events')
    .select('id')
    .eq('venue_id', venueId)
    .eq('guest_id', guestId)
    .limit(1);
  if (error) {
    console.warn('[import] marketing history lookup failed; leaving consent unchanged', error.message);
    return true;
  }
  return (data ?? []).length > 0;
}

/** True when the update needs `hasRecordedChoice` to decide, so callers can skip the lookup otherwise. */
export function marketingUpdateNeedsHistory(
  prev: { marketing_consent?: boolean | null; marketing_opt_out?: boolean | null },
  answer: ImportMarketingAnswer | null,
): boolean {
  return answer !== 'opt_out' && !prev.marketing_consent && !prev.marketing_opt_out;
}
