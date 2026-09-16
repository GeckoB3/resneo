/**
 * What a service's collective state is, in one vocabulary (plan Appendix E contract 5; W5).
 *
 * Defined once and read by the Services API, the host's page, the member's page and `VenueSyncPill`,
 * so the words a host sees never disagree with the words a member sees.
 *
 *   role    what this service is to this venue:
 *             master   the host's own service, on the collective page
 *             replica  a member's copy of a service on the page
 *             retired  a copy of a service the host has taken off the page: its calendars and
 *                      bookings stay, it just takes no new bookings
 *             parked   the venue's own service, not on the page, so not bookable while it is live
 *   status  how the copies are doing right now:
 *             up_to_date  every venue has the current version
 *             setting_up  a member's copy has not been made yet (the first apply is due)
 *             updating    a change is on its way to at least one venue
 *             failed      an update failed and is being retried
 *             hidden      nothing is wrong with the copy, but guests cannot book it somewhere
 *             paused      the collective's page is paused
 */
import type { ProviderExclusion } from '@/lib/linked-accounts/replicas/derived-catalogue';

export type CollectiveServiceRole = 'master' | 'replica' | 'retired' | 'parked';
export type CollectiveServiceStatus = 'up_to_date' | 'updating' | 'setting_up' | 'failed' | 'hidden' | 'paused';

export interface CollectiveHiddenReason {
  venue_id: string;
  venue_name: string;
  reason: ProviderExclusion;
}

export interface CollectiveLinkState {
  venue_id: string;
  venue_name: string;
  /** Null until the first apply has made the member's copy. */
  replica_service_id: string | null;
  behind: boolean;
  failing: boolean;
  last_applied_at: string | null;
}

export interface CollectiveServiceStatusInput {
  role: CollectiveServiceRole;
  paused: boolean;
  links: CollectiveLinkState[];
  hiddenReasons: CollectiveHiddenReason[];
}

export interface CollectiveServiceStatusResult {
  status: CollectiveServiceStatus;
  /** A short plain sentence for the pill's tooltip, or null when there is nothing to explain. */
  status_reason: string | null;
  last_applied_at: string | null;
}

const list = (names: string[]): string =>
  names.length <= 1 ? names[0] ?? '' : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

function hiddenSentence(reasons: CollectiveHiddenReason[]): string {
  const byReason = new Map<ProviderExclusion, string[]>();
  for (const r of reasons) {
    byReason.set(r.reason, [...(byReason.get(r.reason) ?? []), r.venue_name]);
  }
  const parts: string[] = [];
  const venues = (reason: ProviderExclusion) => list(byReason.get(reason) ?? []);
  if (byReason.has('payments')) parts.push(`card payments are not set up at ${venues('payments')}`);
  if (byReason.has('forms')) parts.push(`forms are switched off at ${venues('forms')}`);
  if (byReason.has('suspended')) parts.push(`${venues('suspended')} is suspended`);
  if (byReason.has('staff_only')) parts.push('it is staff bookings only');
  if (byReason.has('behind')) parts.push(`${venues('behind')} is still updating`);
  return `Guests cannot book this everywhere: ${list(parts)}.`;
}

/** The one answer for a service's collective status, and the sentence that goes with it. */
export function resolveCollectiveServiceStatus(
  input: CollectiveServiceStatusInput,
): CollectiveServiceStatusResult {
  const lastApplied = input.links
    .map((l) => l.last_applied_at)
    .filter((at): at is string => Boolean(at))
    .sort()
    .at(-1) ?? null;

  if (input.paused) {
    return { status: 'paused', status_reason: 'The collective page is paused, so nothing is bookable on it.', last_applied_at: lastApplied };
  }
  const failing = input.links.filter((l) => l.failing);
  if (failing.length > 0) {
    return {
      status: 'failed',
      status_reason: `An update to ${list(failing.map((l) => l.venue_name))} did not go through. It is being retried.`,
      last_applied_at: lastApplied,
    };
  }
  const settingUp = input.links.filter((l) => !l.replica_service_id);
  if (settingUp.length > 0) {
    return {
      status: 'setting_up',
      status_reason: `${list(settingUp.map((l) => l.venue_name))} is still setting this service up.`,
      last_applied_at: lastApplied,
    };
  }
  const behind = input.links.filter((l) => l.behind);
  if (behind.length > 0) {
    return {
      status: 'updating',
      status_reason: `A change is on its way to ${list(behind.map((l) => l.venue_name))}.`,
      last_applied_at: lastApplied,
    };
  }
  if (input.hiddenReasons.length > 0) {
    return { status: 'hidden', status_reason: hiddenSentence(input.hiddenReasons), last_applied_at: lastApplied };
  }
  return { status: 'up_to_date', status_reason: null, last_applied_at: lastApplied };
}
