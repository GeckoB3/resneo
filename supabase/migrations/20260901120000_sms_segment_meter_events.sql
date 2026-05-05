-- SMS usage is counted and billed by Twilio segment.
-- The existing sms_usage.messages_sent column is retained for compatibility,
-- but now represents segments used in the billing period.

ALTER TABLE sms_usage ADD COLUMN IF NOT EXISTS stripe_period_start TIMESTAMPTZ;
ALTER TABLE sms_usage ADD COLUMN IF NOT EXISTS stripe_period_end TIMESTAMPTZ;
ALTER TABLE sms_usage ADD COLUMN IF NOT EXISTS overage_reported_count INT NOT NULL DEFAULT 0;
ALTER TABLE sms_usage ADD COLUMN IF NOT EXISTS last_stripe_meter_event_at TIMESTAMPTZ;

ALTER TABLE sms_usage DROP CONSTRAINT IF EXISTS sms_usage_venue_id_billing_month_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sms_usage_venue_calendar_month
  ON sms_usage (venue_id, billing_month)
  WHERE stripe_period_start IS NULL AND stripe_period_end IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sms_usage_venue_period
  ON sms_usage (venue_id, stripe_period_start, stripe_period_end)
  WHERE stripe_period_start IS NOT NULL AND stripe_period_end IS NOT NULL;

DROP FUNCTION IF EXISTS increment_sms_usage(uuid, date);
DROP FUNCTION IF EXISTS increment_sms_usage(uuid, date, int, timestamptz, timestamptz);

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
        sms_usage.id,
        GREATEST(0, sms_usage.messages_sent - sms_usage.messages_included)
          - GREATEST(0, sms_usage.messages_sent - v_segments - sms_usage.messages_included) AS delta,
        sms_usage.overage_count,
        sms_usage.overage_reported_count,
        sms_usage.messages_sent,
        sms_usage.messages_included,
        sms_usage.overage_rate_pence
    )
    SELECT id, delta, overage_count, overage_reported_count, messages_sent, messages_included, overage_rate_pence
    FROM upserted;
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
        sms_usage.id,
        GREATEST(0, sms_usage.messages_sent - sms_usage.messages_included)
          - GREATEST(0, sms_usage.messages_sent - v_segments - sms_usage.messages_included) AS delta,
        sms_usage.overage_count,
        sms_usage.overage_reported_count,
        sms_usage.messages_sent,
        sms_usage.messages_included,
        sms_usage.overage_rate_pence
    )
    SELECT id, delta, overage_count, overage_reported_count, messages_sent, messages_included, overage_rate_pence
    FROM upserted;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION increment_sms_usage(uuid, date, int, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION increment_sms_usage(uuid, date, int, timestamptz, timestamptz) TO service_role;
