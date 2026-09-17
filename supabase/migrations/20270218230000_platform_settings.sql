-- D37: where the switch that puts new collectives on shared services lives.
--
-- A platform-level setting, changed on the platform console and audited there
-- (platform_audit_events), deciding only which `service_model` a NEW collective is created with.
-- `venue_collectives.service_model` stays the per-collective truth, and existing collectives move
-- only through scripts/collective-replicas-migrate.mjs (W9). Not a venue feature flag: a collective
-- spans venues, so no venue's flag could decide it.
--
-- Service role only: RLS on with no policies, and no grants to client roles.

CREATE TABLE IF NOT EXISTS public.platform_settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  CONSTRAINT platform_settings_known_key CHECK (key IN ('new_collective_service_model')),
  CONSTRAINT platform_settings_new_collective_model_valid CHECK (
    key <> 'new_collective_service_model' OR value IN ('"legacy_copies"'::jsonb, '"replicas"'::jsonb)
  )
);

COMMENT ON TABLE public.platform_settings IS
  'Platform-wide settings changed on the platform console (audited in platform_audit_events). Service role only.';

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.platform_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.platform_settings TO service_role;

-- New collectives keep the older model until the owner switches this on the console (RT2-28).
INSERT INTO public.platform_settings (key, value)
VALUES ('new_collective_service_model', '"legacy_copies"'::jsonb)
ON CONFLICT (key) DO NOTHING;
