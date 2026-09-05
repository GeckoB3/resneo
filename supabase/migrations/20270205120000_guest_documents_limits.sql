-- Guest documents (the contact panel's Records section): cap files at 10 MB and
-- restrict the bucket to photos, PDF, Word and Excel.
--
-- WHY. Storage bills on bytes stored and bytes served, and the Records grid
-- serves the original file as each thumbnail. The 50 MB cap set with the bucket
-- was never a considered number, and the bucket accepted any type, so a venue
-- could store video and archives under a client. Photos are now downscaled in
-- the browser before upload (src/lib/guests/downscale-image.ts), so 10 MB is
-- ample for anything the section is for.
--
-- The allowlist here must stay identical to GUEST_DOCUMENT_ALLOWED_MIME_TYPES in
-- src/lib/guests/guest-document-limits.ts: the sign route refuses first with a
-- readable message, and the bucket refuses the PUT itself as the backstop.
--
-- Existing objects are untouched; the limits apply to new uploads only.

UPDATE storage.buckets
SET
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/heic',
    'image/heif',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
WHERE id = 'guest-documents';
