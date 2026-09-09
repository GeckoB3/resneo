-- Canonical shape for processing that reaches the end of a service.
--
-- Two stored shapes said the same thing: a 120 minute service with a processing block at
-- 60..120 (what the editor produced before 2026-09-08), and a 60 minute service with a
-- block at 60..120 (what it produces now). The engine and the diary read both as "the
-- practitioner is free from minute 60", but the booked length (booking_end_time, the
-- modify form, the customer's confirmation) came from duration_minutes, so the first shape
-- booked two hours where the second booked one. A service copied into a partner venue
-- before its origin was re-edited therefore booked a different length from its origin.
--
-- The rule (owner, 2026-09-09): the service duration excludes any processing that runs to
-- or beyond its end. The application applies it on save, on copy and on read
-- (`canonicalServiceShape` in src/lib/appointments/processing-time.ts); this backfill makes
-- the stored rows agree, so the service editor shows the same numbers the diary books.
--
-- DATA ONLY. No schema change, expand-safe: old code reading a rewritten row sees a valid
-- service whose total span (duration + processing after it) is exactly what it was.
-- Existing bookings are not touched; their booking_end_time is history.
--
-- Algorithm, per row with a non-empty block array (mirrors processingActiveEndMinutes):
--   active_end := duration; for blocks from the latest start down: if the block starts at
--   or before active_end and ends at or after it, active_end := its start.
--   If active_end < duration and active_end >= 5: blocks starting at or after active_end
--   are merged into one block [active_end, max end), the others are kept, and
--   duration := active_end.

CREATE OR REPLACE FUNCTION pg_temp.canonical_service_shape(p_duration integer, p_blocks jsonb)
RETURNS TABLE (duration_minutes integer, processing_time_blocks jsonb, changed boolean)
LANGUAGE plpgsql
AS $$
DECLARE
  active_end integer := GREATEST(0, p_duration);
  blk jsonb;
  b_start integer;
  b_end integer;
  run_end integer := 0;
  first_run jsonb := NULL;
  kept jsonb := '[]'::jsonb;
BEGIN
  IF p_blocks IS NULL OR jsonb_typeof(p_blocks) <> 'array' OR jsonb_array_length(p_blocks) = 0 THEN
    RETURN QUERY SELECT p_duration, COALESCE(p_blocks, '[]'::jsonb), false;
    RETURN;
  END IF;

  FOR blk IN
    SELECT value FROM jsonb_array_elements(p_blocks)
    ORDER BY (value->>'start_minute')::integer DESC
  LOOP
    b_start := COALESCE((blk->>'start_minute')::integer, 0);
    b_end := b_start + COALESCE((blk->>'duration_minutes')::integer, 0);
    IF b_start <= active_end AND b_end >= active_end THEN
      active_end := LEAST(active_end, GREATEST(0, b_start));
    END IF;
  END LOOP;

  IF active_end >= p_duration OR active_end < 5 THEN
    RETURN QUERY SELECT p_duration, p_blocks, false;
    RETURN;
  END IF;

  FOR blk IN
    SELECT value FROM jsonb_array_elements(p_blocks)
    ORDER BY (value->>'start_minute')::integer ASC
  LOOP
    b_start := COALESCE((blk->>'start_minute')::integer, 0);
    b_end := b_start + COALESCE((blk->>'duration_minutes')::integer, 0);
    IF b_start < active_end THEN
      kept := kept || jsonb_build_array(blk);
    ELSE
      IF first_run IS NULL THEN first_run := blk; END IF;
      run_end := GREATEST(run_end, b_end);
    END IF;
  END LOOP;

    -- The merged tail must still pass the application's 480 minute cap; leave a longer one as stored.
  IF run_end - active_end > 480 THEN
    RETURN QUERY SELECT p_duration, p_blocks, false;
    RETURN;
  END IF;

  kept := kept || jsonb_build_array(
    first_run
      || jsonb_build_object('start_minute', active_end, 'duration_minutes', run_end - active_end)
  );

  RETURN QUERY SELECT active_end, kept, true;
END;
$$;

-- An UPDATE's FROM list cannot reference the table being updated, so each table's shapes
-- are computed in a CTE (where LATERAL over the table is allowed) and joined back on id.

-- service_items (unified scheduling catalogue)
WITH shaped AS (
  SELECT s.id, c.duration_minutes, c.processing_time_blocks, c.changed
  FROM service_items s
  CROSS JOIN LATERAL pg_temp.canonical_service_shape(s.duration_minutes, s.processing_time_blocks) c
  WHERE jsonb_typeof(s.processing_time_blocks) = 'array'
    AND jsonb_array_length(s.processing_time_blocks) > 0
)
UPDATE service_items s
SET duration_minutes = shaped.duration_minutes,
    processing_time_blocks = shaped.processing_time_blocks
FROM shaped
WHERE shaped.id = s.id
  AND shaped.changed;

-- appointment_services (legacy catalogue; frozen, but still read by the engine fallback)
WITH shaped AS (
  SELECT s.id, c.duration_minutes, c.processing_time_blocks, c.changed
  FROM appointment_services s
  CROSS JOIN LATERAL pg_temp.canonical_service_shape(s.duration_minutes, s.processing_time_blocks) c
  WHERE jsonb_typeof(s.processing_time_blocks) = 'array'
    AND jsonb_array_length(s.processing_time_blocks) > 0
)
UPDATE appointment_services s
SET duration_minutes = shaped.duration_minutes,
    processing_time_blocks = shaped.processing_time_blocks
FROM shaped
WHERE shaped.id = s.id
  AND shaped.changed;

-- service_variants (options carry their own duration and pattern)
WITH shaped AS (
  SELECT v.id, c.duration_minutes, c.processing_time_blocks, c.changed
  FROM service_variants v
  CROSS JOIN LATERAL pg_temp.canonical_service_shape(v.duration_minutes, v.processing_time_blocks) c
  WHERE jsonb_typeof(v.processing_time_blocks) = 'array'
    AND jsonb_array_length(v.processing_time_blocks) > 0
)
UPDATE service_variants v
SET duration_minutes = shaped.duration_minutes,
    processing_time_blocks = shaped.processing_time_blocks
FROM shaped
WHERE shaped.id = v.id
  AND shaped.changed;

DROP FUNCTION IF EXISTS pg_temp.canonical_service_shape(integer, jsonb);
