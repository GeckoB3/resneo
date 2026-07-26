-- Linked Accounts: drop the dead venue_collectives.allow_any_practitioner column.
--
-- The combined booking page's "Any available" option follows the HOST venue's
-- own any_available_practitioner feature flag (see loadCollectiveVenuePublic),
-- and per-offering pooling is governed by collective_service_items.allow_any_available.
-- This collective-level column was never wired to any behaviour: create always
-- stored false, and the §7.6 "any practitioner" routing it anticipated ships (if
-- ever) against the per-offering model instead. Dropping it removes a settings
-- field that could be toggled with no effect.
--
-- (venue_collective_members.allow_any_practitioner_substitution is a different,
-- deliberately retained column and is untouched.)

ALTER TABLE venue_collectives
  DROP COLUMN IF EXISTS allow_any_practitioner;
