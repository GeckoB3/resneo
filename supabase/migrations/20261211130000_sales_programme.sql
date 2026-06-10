-- Resneo salesperson revenue-share programme (distinct from venue Refer & Earn).
-- Informational tracking only; payments happen outside Resneo.

-- ---------------------------------------------------------------------------
-- Enum: sales_attribution_status
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sales_attribution_status') THEN
    CREATE TYPE sales_attribution_status AS ENUM (
      'pending',
      'active',
      'churned'
    );
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- salespeople
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.salespeople (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 uuid NOT NULL UNIQUE REFERENCES auth.users (id) ON DELETE CASCADE,
  email                   text NOT NULL,
  name                    text,
  active                  boolean NOT NULL DEFAULT true,
  lump_sum_per_signup_pence integer NOT NULL DEFAULT 0,
  revenue_share_percent   numeric(5, 2) NOT NULL DEFAULT 0,
  revenue_share_months    integer NOT NULL DEFAULT 12,
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  revoked_at              timestamptz
);

CREATE INDEX IF NOT EXISTS idx_salespeople_revoked
  ON public.salespeople (revoked_at)
  WHERE revoked_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS salespeople_one_active_email
  ON public.salespeople (lower(trim(email)))
  WHERE revoked_at IS NULL;

COMMENT ON TABLE public.salespeople IS
  'External Resneo sales agents. Access requires app_metadata.sales_agent=true plus an active row.';

-- ---------------------------------------------------------------------------
-- sales_codes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sales_codes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salesperson_id  uuid NOT NULL REFERENCES public.salespeople (id) ON DELETE CASCADE,
  code            text NOT NULL UNIQUE,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sales_codes_code_lower ON public.sales_codes (lower(code));
CREATE INDEX IF NOT EXISTS idx_sales_codes_salesperson ON public.sales_codes (salesperson_id);

CREATE OR REPLACE FUNCTION sales_codes_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sales_codes_updated_at ON public.sales_codes;
CREATE TRIGGER sales_codes_updated_at
  BEFORE UPDATE ON public.sales_codes
  FOR EACH ROW
  EXECUTE PROCEDURE sales_codes_set_updated_at();

-- ---------------------------------------------------------------------------
-- sales_attributions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sales_attributions (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salesperson_id          uuid NOT NULL REFERENCES public.salespeople (id) ON DELETE CASCADE,
  code                    text NOT NULL,
  venue_id                uuid REFERENCES public.venues (id) ON DELETE SET NULL,
  signed_up_at            timestamptz NOT NULL DEFAULT now(),
  trial_bonus_applied_at  timestamptz,
  first_paid_at           timestamptz,
  status                  sales_attribution_status NOT NULL DEFAULT 'pending',
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_attributions_venue
  ON public.sales_attributions (venue_id)
  WHERE venue_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sales_attributions_salesperson ON public.sales_attributions (salesperson_id);
CREATE INDEX IF NOT EXISTS idx_sales_attributions_status ON public.sales_attributions (status);

CREATE OR REPLACE FUNCTION sales_attributions_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sales_attributions_updated_at ON public.sales_attributions;
CREATE TRIGGER sales_attributions_updated_at
  BEFORE UPDATE ON public.sales_attributions
  FOR EACH ROW
  EXECUTE PROCEDURE sales_attributions_set_updated_at();

-- ---------------------------------------------------------------------------
-- sales_invoice_revenue
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sales_invoice_revenue (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attribution_id      uuid NOT NULL REFERENCES public.sales_attributions (id) ON DELETE CASCADE,
  venue_id            uuid NOT NULL REFERENCES public.venues (id) ON DELETE CASCADE,
  period_month        date NOT NULL,
  amount_paid_pence   integer NOT NULL,
  stripe_invoice_id   text NOT NULL UNIQUE,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sales_invoice_revenue_attribution
  ON public.sales_invoice_revenue (attribution_id, period_month);

CREATE INDEX IF NOT EXISTS idx_sales_invoice_revenue_venue
  ON public.sales_invoice_revenue (venue_id, period_month);

-- ---------------------------------------------------------------------------
-- sales_bonus_tiers (per-salesperson ladder)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sales_bonus_tiers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salesperson_id  uuid NOT NULL REFERENCES public.salespeople (id) ON DELETE CASCADE,
  threshold       integer NOT NULL CHECK (threshold > 0),
  amount_pence    integer NOT NULL CHECK (amount_pence >= 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (salesperson_id, threshold)
);

CREATE INDEX IF NOT EXISTS idx_sales_bonus_tiers_salesperson
  ON public.sales_bonus_tiers (salesperson_id, threshold);

-- ---------------------------------------------------------------------------
-- sales_bonus_awards (ratchet ledger — each threshold pays once ever)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sales_bonus_awards (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salesperson_id  uuid NOT NULL REFERENCES public.salespeople (id) ON DELETE CASCADE,
  threshold       integer NOT NULL CHECK (threshold > 0),
  amount_pence    integer NOT NULL CHECK (amount_pence >= 0),
  awarded_month   date NOT NULL,
  awarded_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (salesperson_id, threshold)
);

CREATE INDEX IF NOT EXISTS idx_sales_bonus_awards_salesperson
  ON public.sales_bonus_awards (salesperson_id);

-- ---------------------------------------------------------------------------
-- sales_monthly_statements
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sales_monthly_statements (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salesperson_id          uuid NOT NULL REFERENCES public.salespeople (id) ON DELETE CASCADE,
  period_month            date NOT NULL,
  signups_count           integer NOT NULL DEFAULT 0,
  validated_count         integer NOT NULL DEFAULT 0,
  lump_sum_pence          integer NOT NULL DEFAULT 0,
  revenue_share_pence     integer NOT NULL DEFAULT 0,
  bonus_pence             integer NOT NULL DEFAULT 0,
  active_subscribers_end  integer NOT NULL DEFAULT 0,
  total_pence             integer NOT NULL DEFAULT 0,
  computed_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (salesperson_id, period_month)
);

CREATE INDEX IF NOT EXISTS idx_sales_monthly_statements_period
  ON public.sales_monthly_statements (period_month DESC);

-- ---------------------------------------------------------------------------
-- RLS: sales agents can SELECT their own rows; writes are service-role only
-- ---------------------------------------------------------------------------
ALTER TABLE public.salespeople ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_attributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_invoice_revenue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_bonus_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_bonus_awards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_monthly_statements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sales_agent_select_own_profile" ON public.salespeople;
CREATE POLICY "sales_agent_select_own_profile"
  ON public.salespeople FOR SELECT
  USING (user_id = auth.uid() AND revoked_at IS NULL);

DROP POLICY IF EXISTS "sales_agent_select_own_codes" ON public.sales_codes;
CREATE POLICY "sales_agent_select_own_codes"
  ON public.sales_codes FOR SELECT
  USING (
    salesperson_id IN (
      SELECT id FROM public.salespeople
      WHERE user_id = auth.uid() AND revoked_at IS NULL
    )
  );

DROP POLICY IF EXISTS "sales_agent_select_own_attributions" ON public.sales_attributions;
CREATE POLICY "sales_agent_select_own_attributions"
  ON public.sales_attributions FOR SELECT
  USING (
    salesperson_id IN (
      SELECT id FROM public.salespeople
      WHERE user_id = auth.uid() AND revoked_at IS NULL
    )
  );

DROP POLICY IF EXISTS "sales_agent_select_own_invoice_revenue" ON public.sales_invoice_revenue;
CREATE POLICY "sales_agent_select_own_invoice_revenue"
  ON public.sales_invoice_revenue FOR SELECT
  USING (
    attribution_id IN (
      SELECT sa.id FROM public.sales_attributions sa
      JOIN public.salespeople sp ON sp.id = sa.salesperson_id
      WHERE sp.user_id = auth.uid() AND sp.revoked_at IS NULL
    )
  );

DROP POLICY IF EXISTS "sales_agent_select_own_bonus_tiers" ON public.sales_bonus_tiers;
CREATE POLICY "sales_agent_select_own_bonus_tiers"
  ON public.sales_bonus_tiers FOR SELECT
  USING (
    salesperson_id IN (
      SELECT id FROM public.salespeople
      WHERE user_id = auth.uid() AND revoked_at IS NULL
    )
  );

DROP POLICY IF EXISTS "sales_agent_select_own_bonus_awards" ON public.sales_bonus_awards;
CREATE POLICY "sales_agent_select_own_bonus_awards"
  ON public.sales_bonus_awards FOR SELECT
  USING (
    salesperson_id IN (
      SELECT id FROM public.salespeople
      WHERE user_id = auth.uid() AND revoked_at IS NULL
    )
  );

DROP POLICY IF EXISTS "sales_agent_select_own_statements" ON public.sales_monthly_statements;
CREATE POLICY "sales_agent_select_own_statements"
  ON public.sales_monthly_statements FOR SELECT
  USING (
    salesperson_id IN (
      SELECT id FROM public.salespeople
      WHERE user_id = auth.uid() AND revoked_at IS NULL
    )
  );
