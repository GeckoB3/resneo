-- Contact Users: emails the platform team composes on /super/contact-users and sends to the
-- account holders of subscribing venues (new features, important news about ResNeo).
--
--   platform_broadcasts            one row per composed email: a draft until it is sent
--   platform_broadcast_recipients  who a sent broadcast went to, one row per email address,
--                                  written as 'pending' before the first send so an interrupted
--                                  send can resume without emailing anyone twice
--   platform_email_opt_outs        account holders who unsubscribed from product news
--                                  (important account notices still reach them)
--
-- Service role only: RLS on with no policies, and no grants to client roles. Everything is read
-- and written by /api/platform/* (superuser) and the public unsubscribe route, both server side.

CREATE TABLE IF NOT EXISTS public.platform_broadcasts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status            text NOT NULL DEFAULT 'draft',
  subject           text NOT NULL DEFAULT '',
  -- eyebrow, headline, intro, body (markdown), sign_off, greeting: see src/lib/platform/broadcast-email.ts
  content           jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Important account notices ignore product-news opt-outs and carry no unsubscribe link.
  important         boolean NOT NULL DEFAULT false,
  -- { "mode": "all" } or { "mode": "selected", "venue_ids": [...] }
  audience          jsonb NOT NULL DEFAULT '{"mode":"all"}'::jsonb,
  created_by        uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_by_email  text,
  sent_by_email     text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  send_started_at   timestamptz,
  sent_at           timestamptz,
  recipient_count   integer NOT NULL DEFAULT 0,
  sent_count        integer NOT NULL DEFAULT 0,
  failed_count      integer NOT NULL DEFAULT 0,
  skipped_count     integer NOT NULL DEFAULT 0,
  CONSTRAINT platform_broadcasts_status_valid
    CHECK (status IN ('draft', 'sending', 'sent', 'partially_sent', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_platform_broadcasts_created_at
  ON public.platform_broadcasts (created_at DESC);

COMMENT ON TABLE public.platform_broadcasts IS
  'Contact Users emails composed on the platform console. Service role only.';

CREATE TABLE IF NOT EXISTS public.platform_broadcast_recipients (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_id         uuid NOT NULL REFERENCES public.platform_broadcasts (id) ON DELETE CASCADE,
  email                text NOT NULL,
  first_name           text,
  venue_ids            uuid[] NOT NULL DEFAULT '{}',
  venue_names          text[] NOT NULL DEFAULT '{}',
  status               text NOT NULL DEFAULT 'pending',
  provider_message_id  text,
  error                text,
  sent_at              timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_broadcast_recipients_status_valid
    CHECK (status IN ('pending', 'sent', 'failed', 'skipped_opted_out')),
  CONSTRAINT platform_broadcast_recipients_unique_email UNIQUE (broadcast_id, email)
);

CREATE INDEX IF NOT EXISTS idx_platform_broadcast_recipients_broadcast_status
  ON public.platform_broadcast_recipients (broadcast_id, status);

COMMENT ON TABLE public.platform_broadcast_recipients IS
  'One row per address a Contact Users email was sent to. Service role only.';

CREATE TABLE IF NOT EXISTS public.platform_email_opt_outs (
  -- Lower-cased address. Keyed by person, not venue: someone who runs two venues opts out once.
  email          text PRIMARY KEY,
  opted_out_at   timestamptz NOT NULL DEFAULT now(),
  broadcast_id   uuid REFERENCES public.platform_broadcasts (id) ON DELETE SET NULL,
  CONSTRAINT platform_email_opt_outs_lower CHECK (email = lower(email))
);

COMMENT ON TABLE public.platform_email_opt_outs IS
  'Account holders who unsubscribed from ResNeo product news. Service role only.';

ALTER TABLE public.platform_broadcasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_broadcast_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_email_opt_outs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.platform_broadcasts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.platform_broadcast_recipients FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.platform_email_opt_outs FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.platform_broadcasts TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.platform_broadcast_recipients TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.platform_email_opt_outs TO service_role;
