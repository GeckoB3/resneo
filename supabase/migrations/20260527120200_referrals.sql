-- Reserve NI: Referral programme
-- See Docs/REFERRAL_PROGRAMME_PLAN.md
--
-- Tables:
--   referral_codes  - one per venue, owns a unique shareable code
--   referrals       - one row per attempted referral, tracks lifecycle to credit
--   referral_audit  - append-only log of status transitions
--
-- Idempotent: safe to re-run on Preview / branch DBs.

-- ---------------------------------------------------------------------------
-- Enum: referral_status
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'referral_status') THEN
    CREATE TYPE referral_status AS ENUM (
      'pending',
      'referee_signed_up',
      'credited',
      'failed',
      'void'
    );
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- referral_codes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS referral_codes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id   uuid NOT NULL UNIQUE REFERENCES venues (id) ON DELETE CASCADE,
  code       text NOT NULL UNIQUE,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_referral_codes_code_lower ON referral_codes (lower(code));
CREATE INDEX IF NOT EXISTS idx_referral_codes_venue ON referral_codes (venue_id);

-- Touch updated_at on UPDATE
CREATE OR REPLACE FUNCTION referral_codes_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS referral_codes_updated_at ON referral_codes;
CREATE TRIGGER referral_codes_updated_at
  BEFORE UPDATE ON referral_codes
  FOR EACH ROW
  EXECUTE PROCEDURE referral_codes_set_updated_at();

-- ---------------------------------------------------------------------------
-- referrals
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS referrals (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                          text NOT NULL,
  -- ON DELETE CASCADE matches the codebase convention for venue FKs (see staff/bookings/etc.).
  -- The hard-delete script would otherwise fail when a venue has authored referrals.
  referrer_venue_id             uuid NOT NULL REFERENCES venues (id) ON DELETE CASCADE,
  -- SET NULL preserves the row when the referee is deleted (audit history of the credit).
  referred_venue_id             uuid REFERENCES venues (id) ON DELETE SET NULL,
  status                        referral_status NOT NULL DEFAULT 'pending',
  referee_trial_applied_at      timestamptz,
  referrer_credited_at          timestamptz,
  referrer_credit_amount_pence  integer,
  referrer_credit_currency      text DEFAULT 'gbp',
  stripe_balance_transaction_id text,
  void_reason                   text,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now()
);

-- One credit per referred venue, ever.
CREATE UNIQUE INDEX IF NOT EXISTS uq_referrals_referred_venue
  ON referrals (referred_venue_id)
  WHERE referred_venue_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals (referrer_venue_id);
CREATE INDEX IF NOT EXISTS idx_referrals_status ON referrals (status);
CREATE INDEX IF NOT EXISTS idx_referrals_code_lower ON referrals (lower(code));

CREATE OR REPLACE FUNCTION referrals_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS referrals_updated_at ON referrals;
CREATE TRIGGER referrals_updated_at
  BEFORE UPDATE ON referrals
  FOR EACH ROW
  EXECUTE PROCEDURE referrals_set_updated_at();

-- ---------------------------------------------------------------------------
-- referral_audit (append-only log)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS referral_audit (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id uuid NOT NULL REFERENCES referrals (id) ON DELETE CASCADE,
  from_status referral_status,
  to_status   referral_status NOT NULL,
  detail      jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_referral_audit_referral
  ON referral_audit (referral_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- RLS
-- Pattern matches existing venue/staff RLS: identify staff by auth.jwt() email.
-- All WRITES are service-role only (no INSERT/UPDATE/DELETE policy).
-- ---------------------------------------------------------------------------
ALTER TABLE referral_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff_select_own_referral_code" ON referral_codes;
CREATE POLICY "staff_select_own_referral_code"
  ON referral_codes FOR SELECT
  USING (
    venue_id IN (
      SELECT venue_id FROM staff
      WHERE email = (auth.jwt() ->> 'email')
    )
  );

DROP POLICY IF EXISTS "staff_select_own_referrals_as_referrer" ON referrals;
CREATE POLICY "staff_select_own_referrals_as_referrer"
  ON referrals FOR SELECT
  USING (
    referrer_venue_id IN (
      SELECT venue_id FROM staff
      WHERE email = (auth.jwt() ->> 'email')
    )
  );

-- referral_audit: no SELECT policy = service role only.

-- ---------------------------------------------------------------------------
-- Backfill: ensure every existing venue has a referral_codes row.
-- Code format: SLUG-XXXX (suffix 4 chars from [A-HJ-NP-Z2-9]).
-- Collision-safe via the UNIQUE(code) constraint + ON CONFLICT DO NOTHING.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_row record;
  v_slug text;
  v_suffix text;
  v_code text;
  v_attempts integer;
  v_inserted boolean;
BEGIN
  FOR v_row IN
    SELECT v.id, COALESCE(NULLIF(trim(v.name), ''), 'venue') AS name
    FROM venues v
    LEFT JOIN referral_codes rc ON rc.venue_id = v.id
    WHERE rc.id IS NULL
      -- Skip placeholder names so these venues get a real slug at first dashboard view.
      AND lower(trim(v.name)) <> 'my business'
  LOOP
    -- Slugify: keep A-Z and 0-9, replace others with '-', collapse, trim.
    v_slug := upper(regexp_replace(v_row.name, '[^A-Za-z0-9]+', '-', 'g'));
    v_slug := regexp_replace(v_slug, '(^-+|-+$)', '', 'g');
    IF v_slug = '' THEN
      v_slug := 'VENUE';
    END IF;
    IF length(v_slug) > 20 THEN
      v_slug := substr(v_slug, 1, 20);
      v_slug := regexp_replace(v_slug, '-+$', '', 'g');
      IF v_slug = '' THEN
        v_slug := 'VENUE';
      END IF;
    END IF;

    v_attempts := 0;
    v_inserted := false;
    WHILE v_attempts < 10 AND NOT v_inserted LOOP
      v_suffix := '';
      FOR i IN 1..4 LOOP
        v_suffix := v_suffix || substr(
          'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
          1 + floor(random() * 31)::int,
          1
        );
      END LOOP;
      v_code := v_slug || '-' || v_suffix;

      BEGIN
        INSERT INTO referral_codes (venue_id, code) VALUES (v_row.id, v_code);
        v_inserted := true;
      EXCEPTION WHEN unique_violation THEN
        v_attempts := v_attempts + 1;
      END;
    END LOOP;

    IF NOT v_inserted THEN
      RAISE WARNING 'Failed to generate referral code for venue %', v_row.id;
    END IF;
  END LOOP;
END $$;
