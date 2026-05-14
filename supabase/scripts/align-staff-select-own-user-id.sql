-- One-off alignment: replace staff_select_own with user_id + email (matches staging and
-- supabase/migrations/20260629120000_user_accounts_foundation.sql).
--
-- Use when live still has email-only staff_select_own while staging has the extended USING.
-- Run in Supabase SQL Editor on the target project (e.g. production) after review/backup.
-- Idempotent: DROP IF EXISTS then CREATE.

DROP POLICY IF EXISTS "staff_select_own" ON public.staff;
CREATE POLICY "staff_select_own"
  ON public.staff FOR SELECT
  USING (
    email = (auth.jwt() ->> 'email')
    OR (user_id IS NOT NULL AND user_id = auth.uid())
  );
