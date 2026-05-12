-- Reserve NI: Storage bucket for venue cover photos
-- Uploads are done server-side via API (admin client). Public read for display.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'venue-covers',
  'venue-covers',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "venue_cover_public_read" ON storage.objects;

CREATE POLICY "venue_cover_public_read"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'venue-covers');
