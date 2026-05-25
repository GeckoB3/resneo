-- Phase 1.4.5: mirror Stripe subscription current_period_start so we can anchor
-- membership allowance period resets without re-deriving from interval math.

ALTER TABLE public.class_memberships
  ADD COLUMN IF NOT EXISTS current_period_start timestamptz;

COMMENT ON COLUMN public.class_memberships.current_period_start IS
  'Mirrored from Stripe subscription. Anchor for allowance period reset.';
