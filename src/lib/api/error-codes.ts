/**
 * The customer API's error vocabulary and response conventions (P0-11, closes
 * G26, enables §5D).
 *
 * Why this exists: every route Phases 1 to 4 add inherits whatever conventions
 * are in force when it is written. Settling them across ~30 handlers now is
 * mechanical; doing it after another client parses the responses is a breaking
 * change.
 *
 * A `code` with no stable vocabulary buys a client nothing, so the set is
 * enumerated here as one exported union rather than left to each handler.
 * Today a mobile client must string-match English prose to tell "This course is
 * full" from "You are already enrolled", which are both 409 from the same file.
 *
 * THE RULE THAT MATTERS: add `code`, never move a value out of `error`.
 * All three booking create routes return `error: 'COMPLIANCE_REQUIREMENT_UNMET'`
 * and the shipped app matches that exact string in four places to drive its
 * `override_compliance` retry. Tidying it into `code` breaks that flow. (Since
 * 2026-09-01 staff are never blocked by compliance, so the app no longer sees
 * that 409 on its own bookings and the retry is dormant; the field it sends is
 * ignored, not rejected, because the staff schemas strip unknown keys.)
 * Because the app checks `code` first and falls back to prose, new codes can
 * ship on the server before any app release, which is the cheapest upgrade
 * path available.
 */

export const API_ERROR_CODES = [
  // ── Auth and session ────────────────────────────────────────────────────
  /** No credential, or one that does not resolve to a user. */
  'UNAUTHENTICATED',
  /** Authenticated, but not permitted to act on this resource. */
  'FORBIDDEN',
  /** A fresh authentication is required before this action (AD7, P3-4b). */
  'STEP_UP_REQUIRED',
  /** The caller holds a limited portal session, which may not do this (AD7). */
  'LIMITED_SESSION',
  /** The client build is too old to be served safely (C15). */
  'CLIENT_TOO_OLD',

  // ── Booking lifecycle ───────────────────────────────────────────────────
  /**
   * The booking is already cancelled. Not hypothetical: /api/confirm guards a
   * double cancel with a 400 and prose, so a mobile retry after a timeout
   * cannot currently tell "I already did this" from "you may not do this".
   */
  'ALREADY_CANCELLED',
  /** The cancellation deadline has passed. */
  'PAST_CANCELLATION_DEADLINE',
  /** The venue has guest self-reschedule switched off. */
  'SELF_RESCHEDULE_DISABLED',
  /** The requested slot went while the guest was choosing. */
  'SLOT_TAKEN',
  /** Someone else wrote this row first; re-read and retry. */
  'STALE_RESOURCE',

  // ── Class and course commerce ───────────────────────────────────────────
  'CLASS_FULL',
  'ALREADY_ENROLLED',
  'INSUFFICIENT_CREDITS',

  // ── Compliance ──────────────────────────────────────────────────────────
  /**
   * Mirrors the existing `error` string rather than replacing it. The shipped
   * app matches the ERROR field for this one; the code is additive.
   */
  'COMPLIANCE_REQUIREMENT_UNMET',

  // ── Already shipped before this task, found by the sweep in
  //    customer-api-contract.test.ts and adopted rather than renamed.
  //    Renaming a code already on the wire breaks whoever reads it, and the
  //    plan's own rule is that codes are additive. ─────────────────────────
  /** A refund could not be processed; the booking was NOT cancelled. */
  'REFUND_FAILED',
  /** The booking's deposit is unpaid, so the requested action is refused. */
  'DEPOSIT_UNPAID',
  /** The venue is at its plan's calendar limit. */
  'PLAN_CALENDAR_LIMIT',
  /** The venue is at its plan's staff limit. */
  'PLAN_STAFF_LIMIT',
  /** Downgrade blocked: too many active calendars for the light plan. */
  'LIGHT_DOWNGRADE_CALENDARS',
  /** Downgrade blocked: too many active staff for the light plan. */
  'LIGHT_DOWNGRADE_STAFF',

  // ── Team members ────────────────────────────────────────────────────────
  /**
   * The email already works at another venue. One login at two venues cannot
   * open either dashboard, so the invite is refused rather than creating that
   * state (collective plan D38).
   */
  'STAFF_EMAIL_AT_OTHER_VENUE',
  /**
   * Signup by an email that already works at a venue it does not own. Refused
   * before checkout, because a new venue would put the login at two venues
   * (D38); after a paid checkout it means no venue was created.
   */
  'SIGNUP_EMAIL_IS_TEAM_MEMBER',
  /**
   * staff/create was given an email that already has a login (a customer
   * account, say). That route sets a password the admin chose, so it refuses
   * rather than overwrite someone's credentials; Invite is the path instead.
   */
  'STAFF_EMAIL_HAS_LOGIN',
  /**
   * staff/[id]/reset-password on a row with no login bound to it yet (an invite
   * nobody has accepted) or a revoked row. Resend invite is the path instead.
   */
  'STAFF_LOGIN_NOT_CLAIMED',
  /**
   * staff/[id]/reset-password on a login that is also used outside this venue's
   * team (customer bookings, another venue, platform access), so only its owner
   * may change the password. Resend invite emails them a link instead.
   */
  'STAFF_LOGIN_USED_ELSEWHERE',

  // ── Collectives (plan Appendix D; mapped by src/lib/linked-accounts/replicas/db-errors.ts) ──
  /** A member changed something its collective manages on a service. Ask the host; reload. */
  'COLLECTIVE_MANAGED_SERVICE',
  /** Deleting a service that is on a collective page. Withdraw it from the page first. */
  'COLLECTIVE_OFFERED_SERVICE',
  /** A member changed or used an add-on group its collective manages. */
  'COLLECTIVE_MANAGED_ADDON_GROUP',
  /** A member changed or required a form its collective manages. */
  'COLLECTIVE_MANAGED_COMPLIANCE_TYPE',
  /** The collective's host changes only through a host transfer. */
  'COLLECTIVE_HOST_CHANGE_REFUSED',
  /** A service that follows its collective cannot change its link to another venue's service. */
  'COLLECTIVE_SYNC_COLUMNS_LOCKED',
  /** Only the collective's host may do this. */
  'COLLECTIVE_NOT_HOST',
  /** The collective is still on the old copied-services model, so this action is not available. */
  'COLLECTIVE_LEGACY_MODEL',
  /** Only one of the host's own services can be offered on the collective page. */
  'COLLECTIVE_OFFERING_NEEDS_HOST_SERVICE',
  /** The venue named is not an active member of the collective. Reload the members. */
  'COLLECTIVE_VENUE_NOT_MEMBER',
  /** The calendar named belongs to a different venue than the one given. */
  'COLLECTIVE_CALENDAR_NOT_AT_VENUE',
  /** The member's copy of the service does not exist yet; retry shortly. */
  'COLLECTIVE_REPLICA_NOT_READY',
  /** A host transfer waits until every member's copy is up to date; retry in a few minutes. */
  'COLLECTIVE_LINKS_BEHIND',
  /** Undo is only offered for a minute after a host's save (410). */
  'COLLECTIVE_UNDO_EXPIRED',
  /**
   * A bulk change would stop a calendar offering a service it still has bookings for. Nothing was
   * written: open that service to see the bookings, then send it again acknowledged.
   */
  'COLLECTIVE_AFFECTED_BOOKINGS',
  /** A move of hosting is already pending; cancel it before asking another venue (409). */
  'COLLECTIVE_TRANSFER_PENDING',
  /** Accepting needs the consent the venue was shown, sent back with its version (409). */
  'COLLECTIVE_CONSENT_REQUIRED',
  /** A timezone change while the venue is part of a collective, which shares one timezone (409). */
  'COLLECTIVE_TIMEZONE_LOCKED',
  /** The venue has no active appointments model, so it cannot be invited or accept (409, BM-01). */
  'COLLECTIVE_NO_APPOINTMENTS',
  /** Switching appointments off while the venue is part of a collective (409). */
  'COLLECTIVE_BOOKING_MODEL_LOCKED',
  /** The venues would trade in different currencies: at create, invite and accept, or a change (409). */
  'COLLECTIVE_CURRENCY_MISMATCH',
  /** A venue can be part of one live collective at a time: invite, accept and create refuse a second (409). */
  'COLLECTIVE_VENUE_IN_OTHER_COLLECTIVE',
  /** That member's service is already waiting for its answer to an earlier request (409). */
  'COLLECTIVE_ADOPTION_PENDING',
  /** The adoption was already answered, or can no longer be (409). */
  'COLLECTIVE_ADOPTION_NOT_PENDING',
  /** Another live collective page already uses that venue's page address (409). */
  'COLLECTIVE_ADDRESS_TAKEN',
  /** No request to use this venue's page address is waiting for an answer (409). */
  'COLLECTIVE_ADDRESS_NOT_PENDING',
  /** An older manager action with no shared-services equivalent (MGR-01), each with its own reason (409). */
  'COLLECTIVE_REPLICAS_ALWAYS_FOLLOW',
  'COLLECTIVE_HEADINGS_FOLLOW_SERVICES',
  'COLLECTIVE_EDIT_ON_SERVICES_PAGE',
  /**
   * A new booking, or a booking moved to another service, for a service that is parked: the venue is
   * live in a collective and the service is not one of the collective's. Offer a collective service.
   */
  'COLLECTIVE_SERVICE_PARKED',

  /**
   * The service is marked "staff bookings only" (`is_bookable_online = false`), so a guest-facing
   * source cannot book it; staff sources (phone, walk-in) still can.
   */
  'SERVICE_NOT_BOOKABLE_ONLINE',

  // ── Generic ─────────────────────────────────────────────────────────────
  'VALIDATION_FAILED',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/**
 * The single 401 body for the whole API.
 *
 * `/api/venue/*` used 'Unauthorised' at 259 sites and `/api/account/*` plus
 * `/api/v1/*` used 'Unauthenticated' at 42. Converging on 'Unauthorised'
 * changes the smaller set. Safe in either direction: §5D.0 established by
 * exhaustive search that the app never string-matches the 401 literal
 * anywhere in production code. The `code` below is the machine-readable half,
 * and is what new clients should read.
 */
export const UNAUTHORISED_ERROR = 'Unauthorised' as const;

export interface ApiErrorBody {
  error: string;
  code?: ApiErrorCode;
  [key: string]: unknown;
}

/** Build an error body with its code. Prose stays human, code stays stable. */
export function apiError(error: string, code?: ApiErrorCode, extra?: Record<string, unknown>): ApiErrorBody {
  return { error, ...(code ? { code } : {}), ...(extra ?? {}) };
}

/**
 * Headers for an authenticated JSON response (G26).
 *
 * An authenticated GET without an explicit cache directive can be served
 * stale, which is the same class of defect as the venue-catalogue staleness
 * bug: a customer renames something and the old value survives in a cache they
 * cannot clear. `no-store` rather than `max-age=0` deliberately, matching the
 * five route groups that already do this.
 */
export const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' } as const;
