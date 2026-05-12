-- Row-level progress for long-running import validation (UI polling).

ALTER TABLE import_sessions
  ADD COLUMN IF NOT EXISTS validation_rows_processed int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS validation_rows_total int NOT NULL DEFAULT 0;

COMMENT ON COLUMN import_sessions.validation_rows_processed IS 'Rows scanned so far during validation (best-effort progress for UI).';
COMMENT ON COLUMN import_sessions.validation_rows_total IS 'Total data rows to scan for validation (non-staff files).';
