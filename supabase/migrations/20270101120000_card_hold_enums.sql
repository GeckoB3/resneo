-- Card holds (Migration A): enum values for the card-hold deposit feature.
--
-- deposit_status gains two states:
--   • `Card Held` — a payment method is stored against the booking (no money
--                   taken); staff may charge a no-show fee later.
--   • `Charged`   — the no-show fee has been charged against the stored card.
--
-- class_payment_requirement gains `card_hold` — the "store a card, charge on
-- no-show" requirement. The enum is shared by appointment_services,
-- service_items, class_types, unified_calendars and
-- bookings.resource_payment_requirement, so one ADD VALUE covers all.
-- (Events need no DDL: experience_events.payment_requirement is text.
-- Table rules get booking_restrictions.deposit_type in a follow-up migration.)
--
-- Because `ALTER TYPE … ADD VALUE` cannot be used in the same transaction as
-- DML against the new value (older PG / Supabase compatibility), this
-- migration is standalone: the table and usage live in follow-up migrations.

ALTER TYPE deposit_status ADD VALUE IF NOT EXISTS 'Card Held';
ALTER TYPE deposit_status ADD VALUE IF NOT EXISTS 'Charged';
ALTER TYPE class_payment_requirement ADD VALUE IF NOT EXISTS 'card_hold';
