-- Fix increment_sms_usage return-column ambiguity.
--
-- PL/pgSQL output column names are variables in the function scope. The prior
-- function selected unqualified CTE columns named overage_count/messages_sent,
-- which can resolve ambiguously and prevents sms_usage increments from
-- completing. When that happens, sms_log still records sends but Stripe meter
-- events are never reported.

CREATE OR REPLACE FUNCTION increment_sms_usage(
  p_venue_id uuid,
  p_billing_month date,
  p_segment_count int DEFAULT 1,
  p_period_start timestamptz DEFAULT NULL,
  p_period_end timestamptz DEFAULT NULL
)
RETURNS TABLE (
  usage_id uuid,
  overage_delta int,
  overage_count int,
  overage_reported_count int,
  messages_sent int,
  messages_included int,
  overage_rate_pence int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allow int;
  v_rate int;
  v_tier text;
  v_segments int;
BEGIN
  v_segments := GREATEST(1, COALESCE(p_segment_count, 1));

  SELECT
    LOWER(TRIM(COALESCE(pricing_tier, ''))),
    COALESCE(sms_monthly_allowance,
      CASE
        WHEN LOWER(TRIM(COALESCE(pricing_tier, ''))) IN ('restaurant', 'founding') THEN 800
        WHEN LOWER(TRIM(COALESCE(pricing_tier, ''))) = 'plus' THEN 300
        WHEN LOWER(TRIM(COALESCE(pricing_tier, ''))) = 'light' THEN 0
        ELSE 800
      END
    )
  INTO v_tier, v_allow
  FROM venues
  WHERE id = p_venue_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_rate := CASE WHEN v_tier = 'light' THEN 8 ELSE 6 END;

  IF p_period_start IS NOT NULL AND p_period_end IS NOT NULL THEN
    RETURN QUERY
    WITH upserted AS (
      INSERT INTO sms_usage (
        venue_id,
        billing_month,
        stripe_period_start,
        stripe_period_end,
        messages_sent,
        messages_included,
        overage_count,
        overage_amount_pence,
        overage_rate_pence
      )
      VALUES (
        p_venue_id,
        p_billing_month,
        p_period_start,
        p_period_end,
        v_segments,
        v_allow,
        GREATEST(0, v_segments - v_allow),
        GREATEST(0, v_segments - v_allow) * v_rate,
        v_rate
      )
      ON CONFLICT (venue_id, stripe_period_start, stripe_period_end)
      WHERE stripe_period_start IS NOT NULL AND stripe_period_end IS NOT NULL
      DO UPDATE SET
        billing_month = EXCLUDED.billing_month,
        messages_included = v_allow,
        overage_rate_pence = v_rate,
        messages_sent = sms_usage.messages_sent + v_segments,
        overage_count = GREATEST(0, sms_usage.messages_sent + v_segments - v_allow),
        overage_amount_pence = GREATEST(0, sms_usage.messages_sent + v_segments - v_allow) * v_rate,
        updated_at = now()
      RETURNING
        sms_usage.id AS usage_id,
        (
          GREATEST(0, sms_usage.messages_sent - sms_usage.messages_included)
          - GREATEST(0, sms_usage.messages_sent - v_segments - sms_usage.messages_included)
        )::int AS overage_delta,
        sms_usage.overage_count AS overage_count,
        sms_usage.overage_reported_count AS overage_reported_count,
        sms_usage.messages_sent AS messages_sent,
        sms_usage.messages_included AS messages_included,
        sms_usage.overage_rate_pence AS overage_rate_pence
    )
    SELECT
      u.usage_id,
      u.overage_delta,
      u.overage_count,
      u.overage_reported_count,
      u.messages_sent,
      u.messages_included,
      u.overage_rate_pence
    FROM upserted AS u;
  ELSE
    RETURN QUERY
    WITH upserted AS (
      INSERT INTO sms_usage (
        venue_id,
        billing_month,
        messages_sent,
        messages_included,
        overage_count,
        overage_amount_pence,
        overage_rate_pence
      )
      VALUES (
        p_venue_id,
        p_billing_month,
        v_segments,
        v_allow,
        GREATEST(0, v_segments - v_allow),
        GREATEST(0, v_segments - v_allow) * v_rate,
        v_rate
      )
      ON CONFLICT (venue_id, billing_month)
      WHERE stripe_period_start IS NULL AND stripe_period_end IS NULL
      DO UPDATE SET
        messages_included = v_allow,
        overage_rate_pence = v_rate,
        messages_sent = sms_usage.messages_sent + v_segments,
        overage_count = GREATEST(0, sms_usage.messages_sent + v_segments - v_allow),
        overage_amount_pence = GREATEST(0, sms_usage.messages_sent + v_segments - v_allow) * v_rate,
        updated_at = now()
      RETURNING
        sms_usage.id AS usage_id,
        (
          GREATEST(0, sms_usage.messages_sent - sms_usage.messages_included)
          - GREATEST(0, sms_usage.messages_sent - v_segments - sms_usage.messages_included)
        )::int AS overage_delta,
        sms_usage.overage_count AS overage_count,
        sms_usage.overage_reported_count AS overage_reported_count,
        sms_usage.messages_sent AS messages_sent,
        sms_usage.messages_included AS messages_included,
        sms_usage.overage_rate_pence AS overage_rate_pence
    )
    SELECT
      u.usage_id,
      u.overage_delta,
      u.overage_count,
      u.overage_reported_count,
      u.messages_sent,
      u.messages_included,
      u.overage_rate_pence
    FROM upserted AS u;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION increment_sms_usage(uuid, date, int, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION increment_sms_usage(uuid, date, int, timestamptz, timestamptz) TO service_role;
