-- Resneo: Booking Site Studio (Phase 1) — per-venue public booking-page branding & content.
-- Stores brand colours, "about" / announcement copy, and social links as a single JSON blob.
-- Shape (all optional):
--   {
--     "brand_primary": "#003b6f",
--     "brand_accent":  "#00c2c7",
--     "about":         "Welcome to ...",
--     "announcement":  "Closed bank holiday Monday",
--     "social_links":  { "instagram": "...", "facebook": "...", "tiktok": "...", "x": "..." }
--   }

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS booking_page_config jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.venues.booking_page_config IS
  'Public booking-page branding/content (Booking Site Studio): brand_primary, brand_accent, about, announcement, social_links.';
