/** Shared types for the Linked Accounts feature. See Docs/reserveni-linked-accounts-spec.md. */

/** Soft UI warning when live link count reaches this threshold (§3). */
export const LINK_COUNT_SOFT_WARNING = 10;

export type LinkStatus =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'revoked'
  | 'expired'
  | 'suspended';

export type LinkCalendarVisibility = 'none' | 'time_only' | 'full_details';

export type LinkActionLevel = 'none' | 'edit_existing' | 'create_edit_cancel';

export type LinkTerminationReason =
  | 'unlinked'
  | 'subscription_lapsed'
  | 'venue_deleted'
  | 'plan_ineligible'
  | 'request_expired';

/** One direction of a link's permissions. */
export interface LinkGrant {
  calendar: LinkCalendarVisibility;
  pii: boolean;
  act: LinkActionLevel;
  /**
   * Calendar-scoped sharing (§18): the granting venue's practitioner/calendar ids
   * this direction is limited to. `null`/`undefined`/empty = ALL of the granting
   * venue's calendars (backward-compatible). Only meaningful when calendar is
   * not `none`; cleared otherwise.
   */
  calendarIds?: string[] | null;
}

/** A negotiated mid-link permission change awaiting acceptance (§6.5). */
export interface PendingChange {
  by_venue_id: string;
  proposed_at: string;
  low_grants_calendar: LinkCalendarVisibility;
  low_grants_pii: boolean;
  low_grants_act: LinkActionLevel;
  low_grants_calendar_ids: string[] | null;
  high_grants_calendar: LinkCalendarVisibility;
  high_grants_pii: boolean;
  high_grants_act: LinkActionLevel;
  high_grants_calendar_ids: string[] | null;
}

/** Raw account_links row as stored. */
export interface AccountLinkRow {
  id: string;
  venue_low_id: string;
  venue_high_id: string;
  requested_by_venue_id: string;
  status: LinkStatus;
  low_grants_calendar: LinkCalendarVisibility;
  low_grants_pii: boolean;
  low_grants_act: LinkActionLevel;
  low_grants_calendar_ids: string[] | null;
  high_grants_calendar: LinkCalendarVisibility;
  high_grants_pii: boolean;
  high_grants_act: LinkActionLevel;
  high_grants_calendar_ids: string[] | null;
  request_message: string | null;
  pending_change: PendingChange | null;
  created_by_user_id: string | null;
  responded_by_user_id: string | null;
  created_at: string;
  responded_at: string | null;
  terminated_at: string | null;
  termination_reason: LinkTerminationReason | null;
  updated_at: string;
}

/**
 * A link as presented to one venue ("me"). Grants are framed as
 * what *I* can do to *them* and what *they* can do to *me*.
 */
export interface AccountLinkView {
  id: string;
  status: LinkStatus;
  /** The other venue on this link. */
  otherVenue: { id: string; name: string; slug: string };
  /** Whether this venue initiated the request. */
  initiatedByMe: boolean;
  /** What I am allowed to do to the other venue's data. */
  iCan: LinkGrant;
  /** What the other venue is allowed to do to my data. */
  theyCan: LinkGrant;
  requestMessage: string | null;
  /** A pending negotiated permission change, if one is awaiting acceptance. */
  pendingChange: {
    proposedByMe: boolean;
    iCan: LinkGrant;
    theyCan: LinkGrant;
    proposedAt: string;
  } | null;
  createdAt: string;
  respondedAt: string | null;
  terminatedAt: string | null;
  terminationReason: LinkTerminationReason | null;
}

export interface AccountLinkAuditRow {
  id: string;
  link_id: string;
  acting_venue_id: string;
  acting_user_id: string | null;
  owning_venue_id: string;
  action_type: string;
  resource_type: string | null;
  resource_id: string | null;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
  created_at: string;
}

export const LIVE_LINK_STATUSES: LinkStatus[] = ['pending', 'accepted', 'suspended'];
export const PAST_LINK_STATUSES: LinkStatus[] = ['rejected', 'revoked', 'expired'];

/** Default preset for a new link request, mutually applied (§5.4). */
export const DEFAULT_LINK_GRANT: LinkGrant = {
  calendar: 'full_details',
  pii: true,
  act: 'edit_existing',
};

/** Outgoing pending request cap per venue (§12). */
export const MAX_PENDING_OUTGOING_REQUESTS = 10;
/** Cooldown before re-requesting a venue that rejected you (§12), in days. */
export const REJECTED_REQUEST_COOLDOWN_DAYS = 7;
/** Pending requests expire this many days after creation (§4.1). */
export const PENDING_REQUEST_EXPIRY_DAYS = 30;
/** A suspended link this many days without restore expires permanently (§6.7). */
export const SUSPENDED_LINK_EXPIRY_DAYS = 30;
