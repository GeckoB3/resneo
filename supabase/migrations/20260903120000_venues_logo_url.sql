-- Reserve NI: Venue logo (separate from cover photo)
--
-- Adds a `logo_url` column to `venues` and provisions a public `venue-logos`
-- storage bucket. The logo is shown as the venue avatar on the public booking
-- page and inside booking confirmation emails (replacing initials when set).
-- The cover photo continues to be used as the wide hero background.

ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS logo_url text;

COMMENT ON COLUMN venues.logo_url IS
  'Public URL for the venue logo. Square image rendered as the avatar on the public booking page and in confirmation emails. Falls back to cover_photo_url, then to initials.';

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'venue-logos',
  'venue-logos',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "venue_logo_public_read"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'venue-logos');
