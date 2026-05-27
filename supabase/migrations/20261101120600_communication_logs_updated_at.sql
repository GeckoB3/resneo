-- communication_logs.updated_at: required by dedupe/retry stale-pending logic in delivery.ts

ALTER TABLE communication_logs
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE communication_logs
SET updated_at = COALESCE(sent_at, created_at)
WHERE updated_at IS DISTINCT FROM COALESCE(sent_at, created_at);

CREATE OR REPLACE FUNCTION communication_logs_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS communication_logs_updated_at ON communication_logs;
CREATE TRIGGER communication_logs_updated_at
  BEFORE UPDATE ON communication_logs
  FOR EACH ROW
  EXECUTE PROCEDURE communication_logs_set_updated_at();
