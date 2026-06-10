-- Platform: mark venues as development/test venues so superuser monitoring
-- can separate them from real (live) venue data.

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.venues.is_test IS
  'Development/test venue flag (set by platform superusers). Test venues are excluded from platform KPIs and subscriber reports.';

-- Partial index: the flag is queried as a filter on every platform list/report.
CREATE INDEX IF NOT EXISTS idx_venues_is_test ON public.venues (is_test) WHERE is_test;
