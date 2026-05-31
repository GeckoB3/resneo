-- Resneo: Booking Site Studio (Phase 2) — storage bucket for "Meet the team" photos.
-- Uploads are server-side via API (admin client); public read for display on /book pages.
-- Photo URLs are stored in venues.booking_page_config.team_profiles (memberId → { photo, ... }).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'venue-team-photos',
  'venue-team-photos',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "venue_team_photo_public_read" ON storage.objects;

CREATE POLICY "venue_team_photo_public_read"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'venue-team-photos');
