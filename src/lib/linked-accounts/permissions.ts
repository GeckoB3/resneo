/** Permission-model logic for Linked Accounts (§5). Shared by UI and server. */

import type {
  AccountLinkRow,
  AccountLinkView,
  LinkActionLevel,
  LinkCalendarVisibility,
  LinkGrant,
} from './types';

const CALENDAR_RANK: Record<LinkCalendarVisibility, number> = {
  none: 0,
  time_only: 1,
  full_details: 2,
};

const ACTION_RANK: Record<LinkActionLevel, number> = {
  none: 0,
  edit_existing: 1,
  create_edit_cancel: 2,
};

/** Canonicalise a calendar-scope list (§18): empty/null → null (= all); else sorted unique. */
export function normaliseCalendarIds(ids: string[] | null | undefined): string[] | null {
  if (!ids || ids.length === 0) return null;
  return [...new Set(ids)].sort();
}

/** True when two canonicalised calendar-scope lists are equivalent. */
export function calendarIdsEqual(a: string[] | null, b: string[] | null): boolean {
  if (a === null || b === null) return a === b;
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/**
 * Force a grant into a coherent state (§5.5). Calendar visibility is the lead
 * dimension; PII and action are clamped down to whatever it allows. The §18
 * calendar scope is canonicalised, and cleared entirely when there is no
 * calendar access (`none`).
 */
export function normaliseGrant(grant: LinkGrant): LinkGrant {
  const calendar = grant.calendar;
  if (calendar === 'none') {
    return { calendar, pii: false, act: 'none', calendarIds: null };
  }
  if (calendar === 'time_only') {
    return { calendar, pii: false, act: 'none', calendarIds: normaliseCalendarIds(grant.calendarIds) };
  }
  // full_details
  const pii = grant.pii;
  const act: LinkActionLevel = pii ? grant.act : 'none';
  return { calendar, pii, act, calendarIds: normaliseCalendarIds(grant.calendarIds) };
}

/** True when scope `n` is at least as restrictive as `c` (n ⊆ c; `null` = all). */
function scopeIsNarrowerOrEqual(n: string[] | null, c: string[] | null): boolean {
  if (c === null) return true; // c = all calendars; any n is narrower-or-equal
  if (n === null) return false; // n = all but c is limited → n is wider
  return n.every((id) => c.includes(id));
}

/** True when scope `n` is at least as broad as `c` (c ⊆ n; `null` = all). */
function scopeIsWiderOrEqual(n: string[] | null, c: string[] | null): boolean {
  if (n === null) return true; // n = all calendars; at least as broad as anything
  if (c === null) return false; // c = all but n is limited → n is narrower
  return c.every((id) => n.includes(id));
}

/** True when the grant is internally consistent without modification. */
export function isGrantCoherent(grant: LinkGrant): boolean {
  const n = normaliseGrant(grant);
  return n.calendar === grant.calendar && n.pii === grant.pii && n.act === grant.act;
}

/** A link must not grant `none` in both directions (§5.5). */
export function isLinkConfigurationValid(a: LinkGrant, b: LinkGrant): boolean {
  return a.calendar !== 'none' || b.calendar !== 'none';
}

/** True when two grants are identical after normalisation (including §18 scope). */
export function grantsEqual(a: LinkGrant, b: LinkGrant): boolean {
  const na = normaliseGrant(a);
  const nb = normaliseGrant(b);
  return (
    na.calendar === nb.calendar &&
    na.pii === nb.pii &&
    na.act === nb.act &&
    calendarIdsEqual(na.calendarIds ?? null, nb.calendarIds ?? null)
  );
}

/** True when `next` grants strictly less-or-equal access than `current` in every dimension. */
export function isReductionOnly(current: LinkGrant, next: LinkGrant): boolean {
  const c = normaliseGrant(current);
  const n = normaliseGrant(next);
  return (
    CALENDAR_RANK[n.calendar] <= CALENDAR_RANK[c.calendar] &&
    (n.pii ? c.pii : true) &&
    ACTION_RANK[n.act] <= ACTION_RANK[c.act] &&
    // Narrowing the calendar scope is a reduction; widening it is not (§18).
    scopeIsNarrowerOrEqual(n.calendarIds ?? null, c.calendarIds ?? null)
  );
}

/** True when `next` grants strictly more-or-equal access than `current`, and differs. */
export function isIncreaseOnly(current: LinkGrant, next: LinkGrant): boolean {
  const c = normaliseGrant(current);
  const n = normaliseGrant(next);
  if (grantsEqual(c, n)) return false;
  return (
    CALENDAR_RANK[n.calendar] >= CALENDAR_RANK[c.calendar] &&
    (n.pii ? true : !c.pii) &&
    ACTION_RANK[n.act] >= ACTION_RANK[c.act] &&
    // Widening the calendar scope is an increase; narrowing it is not (§18).
    scopeIsWiderOrEqual(n.calendarIds ?? null, c.calendarIds ?? null)
  );
}

/**
 * Apply a calendar visibility change with sensible defaults — upgrading to
 * `full_details` from `time_only`/`none` enables PII and edit access (§5.4).
 */
export function applyCalendarVisibilityChange(
  grant: LinkGrant,
  calendar: LinkCalendarVisibility,
): LinkGrant {
  if (
    calendar === 'full_details' &&
    (grant.calendar === 'none' || grant.calendar === 'time_only')
  ) {
    return normaliseGrant({ calendar, pii: true, act: 'edit_existing' });
  }
  return normaliseGrant({ ...grant, calendar });
}

/** Plain-English bullet list of what a grant permits (neutral phrasing). */
export function describeGrant(grant: LinkGrant): string[] {
  const out: string[] = [];
  if (grant.calendar === 'none') return ['have no access to the calendar'];
  const scope = normaliseCalendarIds(grant.calendarIds);
  const scopeNote =
    scope && scope.length > 0
      ? `only for ${scope.length} selected calendar${scope.length === 1 ? '' : 's'}`
      : null;
  if (grant.calendar === 'time_only') {
    out.push('see the calendar as busy/free time blocks only');
    if (scopeNote) out.push(scopeNote);
    return out;
  }
  out.push('see the calendar in full detail');
  if (grant.pii) out.push('see client contact details');
  if (grant.act === 'edit_existing') out.push('edit existing bookings');
  if (grant.act === 'create_edit_cancel') {
    out.push('create, edit and cancel bookings');
  }
  if (scopeNote) out.push(scopeNote);
  return out;
}

const CALENDAR_LABEL: Record<LinkCalendarVisibility, string> = {
  none: 'no access',
  time_only: 'time blocks only',
  full_details: 'full calendar detail',
};

const ACTION_LABEL: Record<LinkActionLevel, string> = {
  none: 'view only',
  edit_existing: 'edit existing bookings',
  create_edit_cancel: 'full booking management',
};

/**
 * Human-readable before→after delta between two grants (§17.5). One bullet per
 * dimension that changed; empty when equivalent. PII / action deltas are only
 * surfaced when both sides keep `full_details` (otherwise the calendar bullet
 * already implies they no longer apply), keeping the diff free of noise.
 */
export function diffGrant(before: LinkGrant, after: LinkGrant): string[] {
  const b = normaliseGrant(before);
  const a = normaliseGrant(after);
  const bullets: string[] = [];
  if (b.calendar !== a.calendar) {
    bullets.push(`Calendar visibility: ${CALENDAR_LABEL[b.calendar]} → ${CALENDAR_LABEL[a.calendar]}`);
  }
  const bothFull = b.calendar === 'full_details' && a.calendar === 'full_details';
  if (bothFull && b.pii !== a.pii) {
    bullets.push(`Client details: ${b.pii ? 'shared' : 'hidden'} → ${a.pii ? 'shared' : 'hidden'}`);
  }
  if (bothFull && b.act !== a.act) {
    bullets.push(`Booking actions: ${ACTION_LABEL[b.act]} → ${ACTION_LABEL[a.act]}`);
  }
  return bullets;
}

/** One-line summary suitable for a table cell. */
export function summariseGrant(grant: LinkGrant): string {
  if (grant.calendar === 'none') return 'No access';
  if (grant.calendar === 'time_only') return 'Time blocks only';
  const parts = ['Full calendar'];
  if (grant.pii) parts.push('client details');
  if (grant.act === 'edit_existing') parts.push('edit bookings');
  if (grant.act === 'create_edit_cancel') parts.push('full booking management');
  const scope = normaliseCalendarIds(grant.calendarIds);
  if (scope && scope.length > 0) parts.push(`${scope.length} calendars`);
  return parts.join(' · ');
}

/** Resolve a stored link row into the perspective of `myVenueId`. */
export function viewLinkForVenue(
  link: AccountLinkRow,
  myVenueId: string,
  venueLookup: Record<string, { name: string; slug: string }>,
): AccountLinkView | null {
  const iAmLow = link.venue_low_id === myVenueId;
  const iAmHigh = link.venue_high_id === myVenueId;
  if (!iAmLow && !iAmHigh) return null;

  const otherVenueId = iAmLow ? link.venue_high_id : link.venue_low_id;
  const other = venueLookup[otherVenueId] ?? { name: 'Unknown venue', slug: '' };

  // "they can do X to my data" = the grant I (owner) gave the other direction.
  // If I am low: low_grants_* is what the high venue may do to me.
  const theyCan: LinkGrant = normaliseGrant(
    iAmLow
      ? {
          calendar: link.low_grants_calendar,
          pii: link.low_grants_pii,
          act: link.low_grants_act,
          calendarIds: link.low_grants_calendar_ids,
        }
      : {
          calendar: link.high_grants_calendar,
          pii: link.high_grants_pii,
          act: link.high_grants_act,
          calendarIds: link.high_grants_calendar_ids,
        },
  );

  const iCan: LinkGrant = normaliseGrant(
    iAmLow
      ? {
          calendar: link.high_grants_calendar,
          pii: link.high_grants_pii,
          act: link.high_grants_act,
          calendarIds: link.high_grants_calendar_ids,
        }
      : {
          calendar: link.low_grants_calendar,
          pii: link.low_grants_pii,
          act: link.low_grants_act,
          calendarIds: link.low_grants_calendar_ids,
        },
  );

  let pendingChange: AccountLinkView['pendingChange'] = null;
  if (link.pending_change) {
    const pc = link.pending_change;
    const pcTheyCan: LinkGrant = normaliseGrant(
      iAmLow
        ? {
            calendar: pc.low_grants_calendar,
            pii: pc.low_grants_pii,
            act: pc.low_grants_act,
            calendarIds: pc.low_grants_calendar_ids,
          }
        : {
            calendar: pc.high_grants_calendar,
            pii: pc.high_grants_pii,
            act: pc.high_grants_act,
            calendarIds: pc.high_grants_calendar_ids,
          },
    );
    const pcICan: LinkGrant = normaliseGrant(
      iAmLow
        ? {
            calendar: pc.high_grants_calendar,
            pii: pc.high_grants_pii,
            act: pc.high_grants_act,
            calendarIds: pc.high_grants_calendar_ids,
          }
        : {
            calendar: pc.low_grants_calendar,
            pii: pc.low_grants_pii,
            act: pc.low_grants_act,
            calendarIds: pc.low_grants_calendar_ids,
          },
    );
    pendingChange = {
      proposedByMe: pc.by_venue_id === myVenueId,
      iCan: pcICan,
      theyCan: pcTheyCan,
      proposedAt: pc.proposed_at,
    };
  }

  return {
    id: link.id,
    status: link.status,
    otherVenue: { id: otherVenueId, name: other.name, slug: other.slug },
    initiatedByMe: link.requested_by_venue_id === myVenueId,
    iCan,
    theyCan,
    requestMessage: link.request_message,
    pendingChange,
    createdAt: link.created_at,
    respondedAt: link.responded_at,
    terminatedAt: link.terminated_at,
    terminationReason: link.termination_reason,
  };
}

/**
 * Map a pair of grants (requester→recipient and recipient→requester) onto the
 * low/high columns of an account_links row.
 */
export function grantsToColumns(params: {
  venueLowId: string;
  venueHighId: string;
  /** Grant authored *by* each venue (what that venue exposes to the other). */
  lowGrants: LinkGrant;
  highGrants: LinkGrant;
}): {
  low_grants_calendar: LinkCalendarVisibility;
  low_grants_pii: boolean;
  low_grants_act: LinkActionLevel;
  low_grants_calendar_ids: string[] | null;
  high_grants_calendar: LinkCalendarVisibility;
  high_grants_pii: boolean;
  high_grants_act: LinkActionLevel;
  high_grants_calendar_ids: string[] | null;
} {
  const low = normaliseGrant(params.lowGrants);
  const high = normaliseGrant(params.highGrants);
  return {
    low_grants_calendar: low.calendar,
    low_grants_pii: low.pii,
    low_grants_act: low.act,
    low_grants_calendar_ids: low.calendarIds ?? null,
    high_grants_calendar: high.calendar,
    high_grants_pii: high.pii,
    high_grants_act: high.act,
    high_grants_calendar_ids: high.calendarIds ?? null,
  };
}

/** Order two venue ids into the low/high pair the schema requires. */
export function orderVenuePair(a: string, b: string): { low: string; high: string } {
  return a < b ? { low: a, high: b } : { low: b, high: a };
}
