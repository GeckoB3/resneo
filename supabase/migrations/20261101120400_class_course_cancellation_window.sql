-- Phase 2 §5.3 — per-course refund window.
--   NULL  = non-refundable
--   0     = cancellable up to first session start
--   N > 0 = cancellable up to N days before the first session start

ALTER TABLE public.class_course_products
  ADD COLUMN IF NOT EXISTS cancellation_window_days int
  CHECK (cancellation_window_days IS NULL OR cancellation_window_days >= 0);

COMMENT ON COLUMN public.class_course_products.cancellation_window_days IS
  'NULL = non-refundable; 0 = up to start; N > 0 = up to N days before first session.';
