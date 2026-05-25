-- Phase 2 §5.2 — atomic, lock-protected credit consumption.
--
-- Acquires a transaction-scoped Postgres advisory lock keyed by (user, venue) so
-- two concurrent class bookings cannot double-spend the same credit balance.
-- Returns a single-row result describing the outcome.

CREATE OR REPLACE FUNCTION public.consume_class_credits_atomically(
  p_user uuid,
  p_venue uuid,
  p_credits int,
  p_booking_id uuid,
  p_class_type_id uuid,
  p_idempotency_prefix text
)
RETURNS TABLE (status text, reason text, credits_consumed int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_redeem uuid;
  v_remaining int := p_credits;
  v_total int := 0;
  v_now timestamptz := now();
  v_batch record;
  v_take int;
  v_idem text;
BEGIN
  IF p_credits <= 0 THEN
    RETURN QUERY SELECT 'error'::text, 'invalid_amount'::text, 0;
    RETURN;
  END IF;

  -- Idempotency: a redeem row for this booking means the spend already happened.
  SELECT id INTO v_existing_redeem
  FROM public.class_credit_ledger
  WHERE booking_id = p_booking_id AND reason = 'redeem'
  LIMIT 1;
  IF FOUND THEN
    RETURN QUERY SELECT 'ok'::text, NULL::text, 0;
    RETURN;
  END IF;

  -- Concurrency: serialise all credit spends for (user, venue) inside this txn.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text || ':' || p_venue::text, 0));

  -- Compute total available, eligible by class type, expiry-filtered, FOR UPDATE
  -- to block parallel writers on the same balance rows.
  CREATE TEMP TABLE _consume_candidates ON COMMIT DROP AS
  SELECT b.id, b.credits_remaining, b.product_id, b.expires_at, b.created_at
  FROM public.user_class_credit_balances b
  WHERE b.user_id = p_user
    AND b.venue_id = p_venue
    AND b.credits_remaining > 0
    AND (b.expires_at IS NULL OR b.expires_at > v_now)
  ORDER BY b.expires_at NULLS LAST, b.created_at ASC
  FOR UPDATE;

  -- Class-type eligibility filter (NULL/empty product list = all class types).
  IF p_class_type_id IS NOT NULL THEN
    DELETE FROM _consume_candidates c
    WHERE NOT EXISTS (
      SELECT 1 FROM public.class_credit_products p
      WHERE p.id = c.product_id
        AND (
          p.eligible_class_type_ids IS NULL
          OR cardinality(p.eligible_class_type_ids) = 0
          OR p_class_type_id = ANY(p.eligible_class_type_ids)
        )
    );
  END IF;

  SELECT COALESCE(SUM(credits_remaining), 0) INTO v_total FROM _consume_candidates;
  IF v_total < p_credits THEN
    RETURN QUERY SELECT 'error'::text, 'insufficient_credits'::text, 0;
    RETURN;
  END IF;

  FOR v_batch IN SELECT * FROM _consume_candidates ORDER BY expires_at NULLS LAST, created_at ASC LOOP
    EXIT WHEN v_remaining <= 0;
    v_take := LEAST(v_batch.credits_remaining, v_remaining);

    UPDATE public.user_class_credit_balances
    SET credits_remaining = credits_remaining - v_take,
        updated_at = v_now
    WHERE id = v_batch.id;

    v_idem := p_idempotency_prefix || ':' || v_batch.id::text;

    INSERT INTO public.class_credit_ledger
      (balance_id, user_id, venue_id, delta_credits, reason, booking_id, idempotency_key, note)
    VALUES
      (v_batch.id, p_user, p_venue, -v_take, 'redeem', p_booking_id, v_idem, 'Redeemed for class booking');

    v_remaining := v_remaining - v_take;
  END LOOP;

  RETURN QUERY SELECT 'ok'::text, NULL::text, (p_credits - v_remaining);
END;
$$;

COMMENT ON FUNCTION public.consume_class_credits_atomically IS
  'Phase 2 §5.2 — atomic FIFO credit spend with pg_advisory_xact_lock to prevent double-spend under concurrent class bookings.';
