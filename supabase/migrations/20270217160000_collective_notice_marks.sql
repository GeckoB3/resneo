-- W5: how far each venue has been told about the host's changes (UX spec §4 N6 and N7).
--
-- The host's saves are recorded as master_changed rows in collective_audit_events, which is
-- append-only, so the rows themselves cannot say "announced". Two notices read them:
--   N6  commercial changes (price, deposit, payment rule, length, buffer, cancellation notice,
--       options), emailed to every member, grouped so a burst of saves is one email;
--   N7  everything else the collective copies, in a daily digest at 18:00 the member's time.
-- Each keeps, per member venue, the time up to which that venue has been told. The notice cron
-- reads the rows after that time, sends, and moves the mark forward.
--
-- Service role only: written by the notice cron, read by nothing else.

CREATE TABLE IF NOT EXISTS public.collective_notice_marks (
  collective_id  uuid NOT NULL REFERENCES public.venue_collectives (id) ON DELETE CASCADE,
  venue_id       uuid NOT NULL REFERENCES public.venues (id) ON DELETE CASCADE,
  kind           text NOT NULL,
  sent_through   timestamptz NOT NULL,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (collective_id, venue_id, kind),
  CONSTRAINT collective_notice_marks_kind_valid CHECK (kind IN ('commercial', 'digest'))
);

ALTER TABLE public.collective_notice_marks ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.collective_notice_marks FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.collective_notice_marks TO service_role;

COMMENT ON TABLE public.collective_notice_marks IS
  'Per member venue, how far the host''s changes have been announced (N6 commercial, N7 digest).';
