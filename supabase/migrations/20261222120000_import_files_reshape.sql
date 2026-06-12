-- -----------------------------------------------------------------------------
-- import_files: AI reshape stage
--
-- Report-style exports (date as a section header with times listed beneath,
-- repeated headers, "Page N" noise) are reshaped by AI into a clean table before
-- mapping. These columns track that: the original CSV is preserved so the user
-- can undo the reshape, and a status drives the upload-step polling/preview.
-- -----------------------------------------------------------------------------

ALTER TABLE import_files
  ADD COLUMN IF NOT EXISTS reshape_status text,           -- null | 'pending' | 'done' | 'failed'
  ADD COLUMN IF NOT EXISTS reshaped boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reshape_model text,
  ADD COLUMN IF NOT EXISTS reshape_notes jsonb,           -- string[] of model assumptions (e.g. inferred first date)
  ADD COLUMN IF NOT EXISTS storage_path_original text;    -- pre-reshape CSV, for "undo to original"
