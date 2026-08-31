import type { SupabaseClient } from '@supabase/supabase-js';
import {
  loadAccountBookings,
  loadAccountSafeGuests,
  type AccountBookingRow,
  type AccountGuestSafeRow,
} from './account-bookings';
import { loadAccountPayments, type AccountPaymentRow } from './account-payments';
import { loadAccountWaitlist, type AccountWaitlistRow } from './account-waitlist';

/**
 * How much this export will carry before it stops and says so.
 *
 * There IS a ceiling, because an unbounded read is a way to make the server do
 * arbitrary work on request. It is far above any real account: the acceptance
 * names 500 bookings across four venues, and this is four times that. When it
 * bites, `truncated` says so in the document rather than the customer
 * receiving a short file that looks complete, which is the failure mode a
 * silent cap has.
 */
const EXPORT_LIMIT = 2000;

export interface AccountExport {
  /** What this file is, in the file, so it can be read years from now. */
  about: {
    description: string;
    exported_at: string;
    money: string;
    times: string;
    completeness: string;
  };
  account: { id: string; email: string | null };
  profile: Record<string, unknown> | null;
  venue_relationships: AccountGuestSafeRow[];
  bookings: AccountBookingRow[];
  payments: AccountPaymentRow[];
  waitlist: AccountWaitlistRow[];
  /** True for any section that hit `EXPORT_LIMIT`, so nothing is cut silently. */
  truncated: { bookings: boolean; payments: boolean; waitlist: boolean };
}

/**
 * Everything this account can already see, in one JSON document (P4-5).
 *
 * **It reads through the same loaders the screens use, and that is the whole
 * security design.** An export is not a licence to widen access, so it takes
 * `loadAccountSafeGuests`, `loadAccountBookings`, `loadAccountPayments` and
 * `loadAccountWaitlist` rather than querying the tables again: any projection
 * they exclude, this excludes, and a future narrowing of them narrows this
 * automatically. Writing fresh queries here would be the one place
 * `internal_notes` and the payment ledger's staff notes could escape, which
 * the Register warns about for the venue-side export.
 *
 * JSON rather than CSV: it must be complete and self-describing, and CSV
 * cannot hold the nesting without inventing a schema nobody agreed.
 */
export async function buildAccountExport(
  session: SupabaseClient,
  admin: SupabaseClient,
  user: { id: string; email?: string | null },
  now: Date = new Date(),
): Promise<AccountExport> {
  /*
    Sequential where it must be: payments are scoped by the bookings the
    session client admitted to owning, so that ownership read has to have
    happened. The rest runs alongside.
  */
  const [profile, relationships, bookings] = await Promise.all([
    loadExportProfile(session, user.id),
    loadAccountSafeGuests(session),
    loadAccountBookings(session, admin, EXPORT_LIMIT),
  ]);

  const [payments, waitlist] = await Promise.all([
    loadAccountPayments(session, admin, { limit: EXPORT_LIMIT }).then((r) => r.payments),
    loadAccountWaitlist(admin, user.email, { limit: EXPORT_LIMIT }),
  ]);

  return {
    about: {
      description:
        'Everything ResNeo holds about this account that the account can see in the portal.',
      exported_at: now.toISOString(),
      /*
        Says the unit by EXAMPLE rather than by naming it. P1-4 bans the word
        from anything a customer reads, for the good reason that no UI should
        print "4500 pence" at somebody; but a machine-readable file does hold
        whole numbers, so the note has to state that, and an example does it
        more clearly than the term would.
      */
      money: 'Amounts are whole numbers in the smallest currency unit: 4500 means £45.00.',
      times:
        'Booking times are given both as venue wall-clock strings and as an exact instant in starts_at.',
      completeness:
        'Venues keep their own records about visits, which are not part of this account and are not included.',
    },
    account: { id: user.id, email: user.email ?? null },
    profile,
    venue_relationships: relationships,
    bookings,
    payments,
    waitlist,
    truncated: {
      bookings: bookings.length >= EXPORT_LIMIT,
      payments: payments.length >= EXPORT_LIMIT,
      waitlist: waitlist.length >= EXPORT_LIMIT,
    },
  };
}

/**
 * The customer's own profile row.
 *
 * `select('*')` deliberately, because `GET /api/account/profile` already
 * returns exactly that to this customer: reading it any other way here would
 * either omit something they can see, making the export incomplete, or invent
 * a second projection to keep in step with the first.
 */
async function loadExportProfile(
  session: SupabaseClient,
  userId: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await session
    .from('user_profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (error) {
    console.error('[buildAccountExport] profile read failed:', error.message);
    throw new Error('Failed to build export');
  }
  return (data as Record<string, unknown> | null) ?? null;
}

/** The filename a customer gets, dated so two exports do not collide. */
export function accountExportFilename(now: Date = new Date()): string {
  return `resneo-account-export-${now.toISOString().slice(0, 10)}.json`;
}
