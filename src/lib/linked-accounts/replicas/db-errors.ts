/**
 * Turns the collective engine's database refusals into coded API answers (plan §6.4 "Errors",
 * Appendix D "Coded errors").
 *
 * Two shapes reach a route:
 *  - the refusals with their own SQLSTATE, `RN001` to `RN007`, raised by the lock and guard
 *    triggers (20270215120000, 20270216120000, 20270217120000);
 *  - `P0001` with a code as the message's first token (`COLLECTIVE_NOT_HOST: ...`), raised by an
 *    engine function after the route has already checked the friendly conditions.
 *
 * Only the codes listed here are mapped. Any other database error returns null and the route answers
 * 500: an engine raise outside the list is a bug to page on, not a message to prettify (GRD-04).
 *
 * The prose is the UX spec's (`svc.member.error.managed`, `svc.delete.error409`,
 * `addons.error.managed`, `comp.type.error.managed`); the names are filled in when the route knows
 * them and fall back to plain words when it does not.
 */
import type { ApiErrorCode } from '@/lib/api/error-codes';
import { apiError, type ApiErrorBody } from '@/lib/api/error-codes';

export const COLLECTIVE_SQLSTATE_CODES = {
  RN001: 'COLLECTIVE_MANAGED_SERVICE',
  RN002: 'COLLECTIVE_OFFERED_SERVICE',
  RN003: 'COLLECTIVE_MANAGED_ADDON_GROUP',
  RN004: 'COLLECTIVE_MANAGED_COMPLIANCE_TYPE',
  RN005: 'COLLECTIVE_HOST_CHANGE_REFUSED',
  RN006: 'COLLECTIVE_SYNC_COLUMNS_LOCKED',
  RN007: 'COLLECTIVE_SERVICE_PARKED',
} as const satisfies Record<string, ApiErrorCode>;

/** Codes an engine function may raise as a `P0001` message prefix, as of the functions shipped. */
export const COLLECTIVE_PREFIXED_CODES = [
  'COLLECTIVE_NOT_HOST',
  'COLLECTIVE_LEGACY_MODEL',
  'COLLECTIVE_OFFERING_NEEDS_HOST_SERVICE',
  'COLLECTIVE_VENUE_NOT_MEMBER',
  'COLLECTIVE_CALENDAR_NOT_AT_VENUE',
  'COLLECTIVE_REPLICA_NOT_READY',
  'COLLECTIVE_LINKS_BEHIND',
  'COLLECTIVE_UNDO_EXPIRED',
  'COLLECTIVE_TRANSFER_PENDING',
  'COLLECTIVE_CONSENT_REQUIRED',
  'COLLECTIVE_ADOPTION_PENDING',
  'COLLECTIVE_ADOPTION_NOT_PENDING',
  'COLLECTIVE_ADDRESS_TAKEN',
  'COLLECTIVE_ADDRESS_NOT_PENDING',
  'COLLECTIVE_MOVE_ATTACHED',
  'COLLECTIVE_MOVE_SERVICE',
  'COLLECTIVE_MOVE_NOT_ALLOWED',
] as const satisfies readonly ApiErrorCode[];

export type CollectiveDbErrorCode =
  | (typeof COLLECTIVE_SQLSTATE_CODES)[keyof typeof COLLECTIVE_SQLSTATE_CODES]
  | (typeof COLLECTIVE_PREFIXED_CODES)[number];

export interface CollectiveNames {
  host?: string | null;
  collective?: string | null;
}

export interface CollectiveDbError {
  /** 409 for every refusal, except an undo that came too late, which is gone (410). */
  status: 409 | 410;
  code: CollectiveDbErrorCode;
  body: ApiErrorBody;
}

function prose(code: CollectiveDbErrorCode, names: CollectiveNames): string {
  const host = names.host?.trim() || 'the host';
  const collective = names.collective?.trim() || 'your collective';
  const page = names.collective?.trim() ? `the ${names.collective.trim()} page` : 'the collective page';
  switch (code) {
    case 'COLLECTIVE_MANAGED_SERVICE':
      return `This service is managed by ${host} for ${collective}. Ask ${host} to change it.`;
    case 'COLLECTIVE_OFFERED_SERVICE':
      return `Take this service off ${page} before deleting it.`;
    case 'COLLECTIVE_MANAGED_ADDON_GROUP':
      return `This add-on group is managed by ${host} for ${collective}. Ask ${host} to change it.`;
    case 'COLLECTIVE_MANAGED_COMPLIANCE_TYPE':
      return `This form is managed by ${host} for ${collective}. Ask ${host} to change it.`;
    case 'COLLECTIVE_HOST_CHANGE_REFUSED':
      return `The host of ${collective} can only change through a host transfer.`;
    case 'COLLECTIVE_SERVICE_PARKED':
      return `This service is not on ${page}, so it cannot take new bookings while your venue is part of ${collective}. Existing bookings are not affected.`;
    case 'COLLECTIVE_SYNC_COLUMNS_LOCKED':
      return 'This service follows its collective, so its link to another venue cannot be changed.';
    case 'COLLECTIVE_NOT_HOST':
      return `Only ${host} can do this for ${collective}.`;
    case 'COLLECTIVE_LEGACY_MODEL':
      return `${collective.charAt(0).toUpperCase()}${collective.slice(1)} has not moved to shared services yet, so this is not available.`;
    case 'COLLECTIVE_OFFERING_NEEDS_HOST_SERVICE':
      return `Only one of ${host}'s own services can go on ${page}.`;
    case 'COLLECTIVE_VENUE_NOT_MEMBER':
      return `That venue is not a member of ${collective} any more. Reload to see the current members.`;
    case 'COLLECTIVE_CALENDAR_NOT_AT_VENUE':
      return 'That calendar belongs to a different venue. Reload and pick the calendar again.';
    case 'COLLECTIVE_REPLICA_NOT_READY':
      return 'This service is still being set up at that venue. Try again in a minute.';
    case 'COLLECTIVE_LINKS_BEHIND':
      return `Some venues' copies of the ${collective} services are still updating. Hosting can move once they are up to date, usually within a few minutes.`;
    case 'COLLECTIVE_UNDO_EXPIRED':
      return 'That change was saved more than a minute ago, so it can no longer be undone. Change it back by hand instead.';
    case 'COLLECTIVE_TRANSFER_PENDING':
      return `A move of hosting for ${collective} is already pending. Cancel it before asking another venue.`;
    case 'COLLECTIVE_CONSENT_REQUIRED':
      return 'Please read what hosting involves and tick the box to agree before accepting.';
    case 'COLLECTIVE_ADOPTION_PENDING':
      return 'That venue has already been asked about this service. Wait for its answer.';
    case 'COLLECTIVE_ADOPTION_NOT_PENDING':
      return 'This has already been answered. Reload to see where things stand.';
    case 'COLLECTIVE_ADDRESS_TAKEN':
      return 'That page address is already used by another collective page.';
    case 'COLLECTIVE_ADDRESS_NOT_PENDING':
      return 'This request has already been answered or withdrawn. Reload to see where things stand.';
    case 'COLLECTIVE_MOVE_ATTACHED':
      return 'This booking has a payment, form or visit attached, so it stays with the venue it was made at.';
    case 'COLLECTIVE_MOVE_SERVICE':
      return 'That calendar does not offer this service, so the booking cannot move there.';
    case 'COLLECTIVE_MOVE_NOT_ALLOWED':
      return `This booking cannot be moved to that venue in ${collective}.`;
  }
}

/**
 * Map a Supabase/PostgREST error (or anything with `code` and `message`) to a coded 409, or null when
 * it is not one of the engine's refusals.
 */
export function collectiveDbError(
  err: { code?: string | null; message?: string | null } | null | undefined,
  names: CollectiveNames = {},
): CollectiveDbError | null {
  if (!err) return null;
  let code: CollectiveDbErrorCode | null = null;
  const sqlstate = err.code ?? '';
  if (sqlstate in COLLECTIVE_SQLSTATE_CODES) {
    code = COLLECTIVE_SQLSTATE_CODES[sqlstate as keyof typeof COLLECTIVE_SQLSTATE_CODES];
  } else if (sqlstate === 'P0001') {
    const prefix = /^([A-Z][A-Z0-9_]*):/.exec(err.message ?? '')?.[1];
    if (prefix && (COLLECTIVE_PREFIXED_CODES as readonly string[]).includes(prefix)) {
      code = prefix as CollectiveDbErrorCode;
    }
  }
  if (!code) return null;
  return { status: code === 'COLLECTIVE_UNDO_EXPIRED' ? 410 : 409, code, body: apiError(prose(code, names), code) };
}
