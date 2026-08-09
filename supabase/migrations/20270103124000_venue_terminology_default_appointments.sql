-- Venue terminology: stop new rows being born as restaurants.
--
-- `venues.terminology` was added with this default:
--
--   NOT NULL DEFAULT '{"client":"Guest","booking":"Reservation","staff":"Staff"}'
--
-- which is the wording for table_reservation, a model that has been
-- deprioritised and that no venue signs up to any more. Every row created
-- without an explicit terminology therefore starts out calling clients Guests
-- and appointments Reservations, and nothing ever revisits it: two venues were
-- found greeting appointment clients with "Reservation Confirmed".
--
-- The four application paths that insert a venue all set terminology from the
-- chosen business type, so the default only lands on rows made another way:
-- seeds, fixtures, support scripts, and direct SQL. Those are exactly the rows
-- nobody thinks to check.
--
-- This changes the default to the appointments wording, which is what the
-- product sells, and repairs rows already carrying the old default.
--
-- WHAT THIS DOES NOT DO:
--   * It does not touch venues on table_reservation. Their wording is correct
--     for them and is left exactly as it is.
--   * It does not overwrite words a venue chose. Only the two values that are
--     literally the table-booking defaults are replaced, and only on venues not
--     using that model.
--   * It does not touch `staff`. The table default for it is "Staff", which is
--     also the appointments default and a plausible deliberate choice
--     elsewhere, so there is no safe way to tell drift from intent in data.
--   * It does not change `business_type`. Some venues run appointments while
--     still recording the business type they signed up with; that is a
--     separate inconsistency and nothing here reads terminology from it.
--
-- Application code resolves terminology against the venue's booking model and
-- already ignores stale table wording, so display is correct either way. This
-- migration is so the stored data stops disagreeing with what is displayed.

ALTER TABLE public.venues
  ALTER COLUMN terminology
  SET DEFAULT '{"client":"Client","booking":"Appointment","staff":"Staff"}'::jsonb;

-- Repair rows that took the old default (or were left behind by a venue that
-- changed model), replacing only the drifted keys with the correct default for
-- the model that venue actually runs.
WITH model_defaults(booking_model, client_word, booking_word) AS (
  VALUES
    ('practitioner_appointment', 'Client', 'Appointment'),
    ('unified_scheduling',       'Client', 'Appointment'),
    ('event_ticket',             'Guest',  'Booking'),
    ('class_session',            'Member', 'Booking'),
    ('resource_booking',         'Booker', 'Booking')
)
UPDATE public.venues v
SET terminology = v.terminology
  || CASE
       WHEN v.terminology->>'client' = 'Guest' AND d.client_word <> 'Guest'
         THEN jsonb_build_object('client', d.client_word)
       ELSE '{}'::jsonb
     END
  || CASE
       WHEN v.terminology->>'booking' = 'Reservation' AND d.booking_word <> 'Reservation'
         THEN jsonb_build_object('booking', d.booking_word)
       ELSE '{}'::jsonb
     END
FROM model_defaults d
-- Compared as text on purpose: `venues.booking_model` is an enum, and casting
-- the literals the other way would make this migration fail outright if the
-- enum ever loses one of these members.
WHERE v.booking_model::text = d.booking_model
  AND (
    (v.terminology->>'client' = 'Guest' AND d.client_word <> 'Guest')
    OR (v.terminology->>'booking' = 'Reservation' AND d.booking_word <> 'Reservation')
  );
