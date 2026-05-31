/** Coalesce burst postgres_changes on venue bookings before refetching list APIs. */
export const REALTIME_BOOKINGS_DEBOUNCE_MS = 2_500;

/**
 * Contacts directory: defer list refetch on venue-wide booking postgres events.
 * Guest rows still refresh immediately on `guests` changes.
 */
export const CONTACTS_BOOKINGS_REFRESH_DEBOUNCE_MS = 60_000;

/**
 * Shared dashboard realtime polling fallback (one timer per venue, tab visible only).
 * Used when the Supabase channel is reconnecting — not the happy path.
 */
export const DASHBOARD_LIVE_POLL_MS = 300_000;

/** Staff waitlist banner poll interval when staff_choose mode may be active. */
export const WAITLIST_ALERTS_POLL_MS = 120_000;

/** Client-side stale window for practitioner roster + appointment services on the calendar. */
export const CALENDAR_CATALOG_STALE_MS = 10 * 60 * 1000;

/** HTTP cache for slow-changing venue catalog GET routes (browser + CDN revalidation). */
export const VENUE_CATALOG_CACHE_CONTROL = 'private, max-age=300, stale-while-revalidate=900';
