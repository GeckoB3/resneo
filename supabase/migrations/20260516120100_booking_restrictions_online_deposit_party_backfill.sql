-- Mirrors intent of 20260410120000 after online_requires_deposit exists (added in 20260516120000).
-- Ensures party-size deposit rules imply online deposit collection.

UPDATE booking_restrictions
SET online_requires_deposit = true
WHERE deposit_required_from_party_size IS NOT NULL;
