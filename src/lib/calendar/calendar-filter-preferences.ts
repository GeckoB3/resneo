/**
 * The Filter menu on the staff calendar (`/dashboard/calendar`), remembered per
 * venue in a cookie.
 *
 * A cookie rather than web storage because the filters are meant to stay until
 * the user changes them, and `/auth/signed-out` answers with
 * `Clear-Site-Data: "storage"`, which empties localStorage and IndexedDB but
 * leaves cookies alone. The rest of the calendar's remembered state (view mode,
 * hour overrides, compact rows) stays in sessionStorage as before.
 */

export interface PractitionerCalendarFilters {
  /** `null` = every calendar; otherwise the column ids to show. */
  visibleCalendarIdsState: string[] | null;
  /** `null` = every linked column; otherwise the `linked:` column keys to show. */
  visibleLinkedColumnIds: string[] | null;
  /** One of `CALENDAR_STATUS_FILTERS`; an unknown value is dropped on read by the view. */
  filterStatus: string;
  /** Day view only: hide columns with no working hours on the selected date. */
  workingHoursOnly: boolean;
}

export const DEFAULT_CALENDAR_FILTERS: PractitionerCalendarFilters = {
  visibleCalendarIdsState: null,
  visibleLinkedColumnIds: null,
  filterStatus: 'all',
  workingHoursOnly: false,
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
/**
 * Browsers cap a cookie at 4096 bytes including its name and attributes. A
 * selection of many calendar ids can approach that, so an oversized value keeps
 * the status and toggle and lets the column lists fall back to "all".
 */
const COOKIE_VALUE_MAX_CHARS = 3800;

export function calendarFiltersCookieName(venueId: string): string {
  return `resneo_calendar_filters_${venueId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNullableStringList(value: unknown, isItem: (s: string) => boolean): value is string[] | null {
  if (value === null) return true;
  return Array.isArray(value) && value.every((v) => typeof v === 'string' && isItem(v));
}

export function isPractitionerCalendarFilters(value: unknown): value is PractitionerCalendarFilters {
  if (!isRecord(value)) return false;
  if (!isNullableStringList(value.visibleCalendarIdsState, (s) => UUID_RE.test(s))) return false;
  if (!isNullableStringList(value.visibleLinkedColumnIds, (s) => s.startsWith('linked:'))) return false;
  if (typeof value.filterStatus !== 'string') return false;
  if (typeof value.workingHoursOnly !== 'boolean') return false;
  return true;
}

export function calendarFiltersAreDefault(filters: PractitionerCalendarFilters): boolean {
  return (
    filters.visibleCalendarIdsState === null &&
    filters.visibleLinkedColumnIds === null &&
    filters.filterStatus === DEFAULT_CALENDAR_FILTERS.filterStatus &&
    filters.workingHoursOnly === DEFAULT_CALENDAR_FILTERS.workingHoursOnly
  );
}

/** The cookie value for `filters`, shrunk to fit if the column lists are too long. */
export function encodeCalendarFilters(filters: PractitionerCalendarFilters): string {
  const full = encodeURIComponent(JSON.stringify(filters));
  if (full.length <= COOKIE_VALUE_MAX_CHARS) return full;
  const trimmed: PractitionerCalendarFilters = {
    ...filters,
    visibleCalendarIdsState: null,
    visibleLinkedColumnIds: null,
  };
  return encodeURIComponent(JSON.stringify(trimmed));
}

export function decodeCalendarFilters(raw: string | null | undefined): PractitionerCalendarFilters | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as unknown;
    return isPractitionerCalendarFilters(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readCookieValue(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const prefix = `${name}=`;
  for (const part of document.cookie.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) return trimmed.slice(prefix.length);
  }
  return null;
}

/** The remembered filters for `venueId`, or `null` when none are stored or the stored value is unreadable. */
export function readCalendarFilterPreferences(venueId: string): PractitionerCalendarFilters | null {
  return decodeCalendarFilters(readCookieValue(calendarFiltersCookieName(venueId)));
}

export function writeCalendarFilterPreferences(venueId: string, filters: PractitionerCalendarFilters): void {
  if (typeof document === 'undefined') return;
  try {
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${calendarFiltersCookieName(venueId)}=${encodeCalendarFilters(filters)}; Max-Age=${COOKIE_MAX_AGE_SECONDS}; Path=/dashboard; SameSite=Lax${secure}`;
  } catch {
    /* ignore: cookies blocked */
  }
}
