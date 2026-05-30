-- How Resneo platform subscription billing is satisfied (Stripe vs superuser-granted free access).

ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS billing_access_source text NOT NULL DEFAULT 'stripe',
  ADD COLUMN IF NOT EXISTS free_access_granted_at timestamptz,
  ADD COLUMN IF NOT EXISTS free_access_granted_by uuid,
  ADD COLUMN IF NOT EXISTS free_access_reason text;

ALTER TABLE venues
  DROP CONSTRAINT IF EXISTS venues_billing_access_source_check;

ALTER TABLE venues
  ADD CONSTRAINT venues_billing_access_source_check
  CHECK (billing_access_source IN ('stripe', 'superuser_free'));

COMMENT ON COLUMN venues.billing_access_source IS
  'stripe = normal Stripe Billing subscription; superuser_free = comped forever via platform superuser (no Stripe subscription).';

COMMENT ON COLUMN venues.free_access_granted_at IS
  'When billing_access_source was set to superuser_free (null for Stripe-backed venues).';

COMMENT ON COLUMN venues.free_access_granted_by IS
  'Supabase auth user id of the platform superuser who granted free access, if known.';

COMMENT ON COLUMN venues.free_access_reason IS
  'Optional note from superuser provisioning (audit).';
