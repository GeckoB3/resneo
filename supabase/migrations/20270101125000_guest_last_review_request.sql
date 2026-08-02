-- When a guest was last asked for a Google review, so regulars are not asked every visit.
--
-- Stamped only when the post-visit thank-you actually carried the review block, not on every
-- thank-you: a venue enabling review requests today must be able to ask a guest who has had
-- thank-you emails for years.
--
-- The cap suppresses the block, never the email. The thank-you still goes out; it simply does not
-- ask again inside the window.

ALTER TABLE guests
  ADD COLUMN IF NOT EXISTS last_review_request_at timestamptz;

COMMENT ON COLUMN guests.last_review_request_at IS
  'Last time a post-visit email included the Google review block. Fixed six-month cap per guest.';
