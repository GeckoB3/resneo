-- Platform superuser registry (complements app_metadata.platform_role + optional PLATFORM_SUPERUSER_EMAILS env).

CREATE TABLE IF NOT EXISTS public.platform_superusers (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_platform_superusers_revoked
  ON public.platform_superusers (revoked_at)
  WHERE revoked_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS platform_superusers_one_active_email
  ON public.platform_superusers (lower(trim(email)))
  WHERE revoked_at IS NULL;

COMMENT ON TABLE public.platform_superusers IS
  'ReserveNI platform dashboard operators. Access requires app_metadata.platform_role=superuser plus either PLATFORM_SUPERUSER_EMAILS env match or app_metadata.platform_superuser_registered=true.';

ALTER TABLE public.platform_superusers ENABLE ROW LEVEL SECURITY;
