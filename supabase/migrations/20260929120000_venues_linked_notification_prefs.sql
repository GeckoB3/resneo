-- Resneo: Linked Accounts — per-venue notification email preferences (spec §17.4).
--
-- Controls which cross-venue write events email the owning venue. In-app
-- notifications (§17.2, the account_link_notifications trigger) are always
-- created regardless of these prefs; this only gates the *email* channel.
-- NULL = use code defaults (cancel/reschedule on, create/notes off).

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS linked_notification_prefs jsonb;

COMMENT ON COLUMN public.venues.linked_notification_prefs IS
  'Linked Accounts email prefs (§17.4): { cancel, reschedule, create, notes } booleans. NULL = defaults.';
