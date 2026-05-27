/** Coalesce burst postgres_changes on venue bookings before refetching list APIs. */
export const REALTIME_BOOKINGS_DEBOUNCE_MS = 2_500;

/** Staff waitlist banner poll interval when staff_choose mode may be active. */
export const WAITLIST_ALERTS_POLL_MS = 120_000;

/** Client-side stale window for practitioner roster + appointment services on the calendar. */
export const CALENDAR_CATALOG_STALE_MS = 10 * 60 * 1000;

/** HTTP cache for slow-changing venue catalog GET routes (browser + CDN revalidation). */
export const VENUE_CATALOG_CACHE_CONTROL = 'private, max-age=300, stale-while-revalidate=900';
