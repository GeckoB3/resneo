-- Import tool rework: staff lists are now mappable files with their own AI
-- column mappings, so the cross-venue mapping cache must accept file_type
-- 'staff' alongside 'clients' and 'bookings'.

ALTER TABLE import_ai_mapping_cache
  DROP CONSTRAINT IF EXISTS import_ai_mapping_cache_file_type_check;

ALTER TABLE import_ai_mapping_cache
  ADD CONSTRAINT import_ai_mapping_cache_file_type_check
  CHECK (file_type IN ('clients', 'bookings', 'staff'));
