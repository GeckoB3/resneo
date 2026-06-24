-- value_map transform (H6): a reviewed raw->canonical lookup for enum-ish columns
-- (booking status, deposit status). The AI proposes the table per provider, the
-- user reviews/edits it on the Review step, and the importer applies it
-- deterministically before normalisation — replacing brittle keyword guessing for
-- provider-specific status codes (CXL/NS/DNA/…). Stored as a JSON object of
-- { "<raw value>": "<canonical value>" }. Parallel to split_config. Idempotent.
ALTER TABLE import_column_mappings
  ADD COLUMN IF NOT EXISTS value_map jsonb;
