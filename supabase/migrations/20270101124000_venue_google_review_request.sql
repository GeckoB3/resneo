-- Google review request on the post-visit thank-you email.
--
-- `google_review_url`: the venue's canonical "write a review" link, normalised on save from a
--   Place ID, a search.google.com write-review link, or a g.page/r short link (see
--   src/lib/reviews/google-review-link.ts). NULL = never configured.
-- `review_request_enabled`: whether the post-visit email includes the review block. Defaults to
--   FALSE for every existing venue, so nobody starts asking their customers for reviews because of
--   a deploy. A venue turns it on deliberately, and cannot turn it on without a usable link.
--
-- No rating is captured anywhere: Google's dialog cannot be pre-set to a star count, so an in-email
-- star picker could only decide who is shown the link, which is review gating and prohibited by
-- Google's review policies.

ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS google_review_url text,
  ADD COLUMN IF NOT EXISTS review_request_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN venues.google_review_url IS
  'Canonical Google write-a-review URL, normalised on save. NULL = not configured.';
COMMENT ON COLUMN venues.review_request_enabled IS
  'Include the Google review block in the post-visit thank-you email. Requires google_review_url.';
