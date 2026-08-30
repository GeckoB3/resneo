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
 * `override_compliance` retry. Tidying it into `code` breaks that flow.
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
