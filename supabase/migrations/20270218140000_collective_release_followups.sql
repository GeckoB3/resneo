-- W7: the work after a release (plan §6.7 "The release", Appendix D `collective_release_member`,
-- RT1-15; UX spec J7 and `review.*`).
--
-- STILL DARK: acts only on release_followup jobs, which only replicas-model collectives create.
--
-- The release queues one release_followup job. After commit, the job copies each photo the member's
-- services showed on the collective page into the member's own storage, so its own page keeps them
-- when the collective's files go. Each copy is recorded as photo_copied or photo_copy_failed, and the
-- review panel after leave or removal reads those rows. Only the engine may write audit rows, so this
-- is the one entry point for them.
--
-- The review panel stays until the venue dismisses it. collective_notice_marks gains a 'review' kind
-- whose sent_through is the time the venue dismissed the panel up to.

CREATE OR REPLACE FUNCTION public.collective_record_release_photo(
  p_operation_id uuid,
  p_service_id uuid,
  p_copied boolean,
  p_detail text,
  p_now timestamptz DEFAULT now()
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_op public.collective_operations%ROWTYPE;
BEGIN
  SELECT * INTO v_op FROM public.collective_operations WHERE id = p_operation_id;
  IF NOT FOUND OR v_op.kind <> 'release_followup' OR v_op.venue_id IS NULL THEN
    RETURN NULL;
  END IF;
  -- Only a service the release handed to this venue.
  IF NOT EXISTS (
    SELECT 1 FROM public.collective_service_replicas r
    JOIN public.venue_collective_members m ON m.id = r.member_id
    WHERE r.replica_service_id = p_service_id AND m.venue_id = v_op.venue_id
      AND m.collective_id = v_op.collective_id AND r.released_at IS NOT NULL
  ) THEN
    RETURN NULL;
  END IF;

  RETURN public.collective_write_audit(
    v_op.collective_id,
    CASE WHEN p_copied THEN 'photo_copied' ELSE 'photo_copy_failed' END,
    NULL, NULL, 'collective-release', v_op.venue_id, NULL, p_service_id, NULL, NULL,
    jsonb_build_object('after', jsonb_build_object('operation_id', p_operation_id,
                                                   'detail', left(coalesce(p_detail, ''), 500))),
    NULL, p_now);
END;
$$;

REVOKE ALL ON FUNCTION public.collective_record_release_photo(uuid, uuid, boolean, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.collective_record_release_photo(uuid, uuid, boolean, text, timestamptz) TO service_role;

ALTER TABLE public.collective_notice_marks DROP CONSTRAINT IF EXISTS collective_notice_marks_kind_valid;
ALTER TABLE public.collective_notice_marks
  ADD CONSTRAINT collective_notice_marks_kind_valid CHECK (kind IN ('commercial', 'digest', 'review'));

COMMENT ON TABLE public.collective_notice_marks IS
  'Per venue: how far the host''s changes have been announced (N6 commercial, N7 digest), and how far the review panel after a release has been dismissed (review).';
