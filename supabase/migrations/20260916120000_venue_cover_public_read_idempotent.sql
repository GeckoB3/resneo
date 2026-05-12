-- Idempotent storage policy: avoid SQLSTATE 42710 when the policy already exists
-- (re-applied migrations, Preview, or manual creation).
DROP POLICY IF EXISTS "venue_cover_public_read" ON storage.objects;

CREATE POLICY "venue_cover_public_read"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'venue-covers');
