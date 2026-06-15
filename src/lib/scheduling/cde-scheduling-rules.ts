/**
 * C/D/E scheduling product rules (ResNeo).
 *
 * Events: recurring and custom schedules are materialised as separate `experience_events` rows so each
 * occurrence has its own id for `bookings.experience_event_id` and ticket capacity.
 *
 * Classes: weekly `class_timetable` + optional `interval_weeks`; ad-hoc `class_instances` may omit `timetable_entry_id`.
 *
 * Resources: weekly `availability_hours` plus per-date `availability_exceptions` (closed or override periods).
 */

export const MAX_MATERIALISED_EVENT_OCCURRENCES = 104;
