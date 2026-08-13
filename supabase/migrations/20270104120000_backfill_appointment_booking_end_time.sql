-- Backfill `bookings.booking_end_time` for appointments created online.
--
-- Why this is needed
-- ------------------
-- The public and composite create routes wrote only `estimated_end_time` and left
-- `booking_end_time` NULL. The availability engine reads a booking's span from
-- `booking_end_time` and, when it is NULL, falls back to the service's CURRENT
-- catalogue duration -- ignoring the chosen variant, any add-on minutes and any
-- per-calendar duration override. A 150-minute variant appointment was therefore
-- valued at its 30-minute parent, and the next guest was offered a slot that ran
-- straight through it.
--
-- The routes now write both columns from one helper
-- (`src/lib/booking/booking-end-time.ts`). This fills in the rows created before
-- that change, so existing appointments stop being under-reserved.
--
-- The conversion
-- --------------
-- Appointment create paths store `estimated_end_time` as the venue-local wall
-- clock encoded as UTC (`Date.UTC(...)`), so reading the UTC time-of-day back out
-- returns that wall clock. `booking_end_time` is exactly that wall clock.
--
-- Deliberately narrow:
--   * Appointment rows only. Class and resource modify paths write
--     `estimated_end_time` as a TRUE UTC instant, so this conversion would be an
--     hour out for them under BST. Resource rows already carry
--     `booking_end_time` from every write path, and class rows are not read
--     through the appointment engine.
--   * Today onward. Past bookings do not affect availability, and leaving them
--     untouched keeps this migration off the vast majority of the table.
--   * NULL only. Any row that already has a value keeps it.
--   * Sane spans only. A converted end that is not after the start (a corrupt or
--     midnight-crossing row) is skipped rather than guessed at; those keep the
--     existing catalogue-duration fallback, which is survivable.

UPDATE public.bookings
SET booking_end_time = ((estimated_end_time AT TIME ZONE 'UTC')::time)
WHERE booking_end_time IS NULL
  AND estimated_end_time IS NOT NULL
  AND booking_date >= CURRENT_DATE
  AND (calendar_id IS NOT NULL OR practitioner_id IS NOT NULL)
  AND experience_event_id IS NULL
  AND class_instance_id IS NULL
  AND resource_id IS NULL
  AND event_session_id IS NULL
  AND ((estimated_end_time AT TIME ZONE 'UTC')::time) > booking_time;
