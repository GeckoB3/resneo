-- Service categories for combined (collective) booking pages.
--
-- WHAT IT IS FOR. 20270202120000 gave each venue category headings for its own
-- booking page. A combined page merges several venues' services into host-curated
-- offerings, so it needs its own headings: the host groups offerings, drags the
-- headings into order, and the page lists them exactly as a single venue's page
-- would. See Docs/service-categories-plan.md, "Combined pages".
--
-- SEAMLESS BY DEFAULT. Offerings are created from member venues' services, and
-- those services usually already sit under a category at their own venue. The
-- app inherits that: when an offering is added, a heading of the same name is
-- found or created here and the offering filed under it; existing pages get the
-- same treatment once, on the host's next visit, recorded in
-- `venue_collectives.categories_seeded_at` so a host who later removes headings
-- is not overruled by the next page load.
--
-- WHY NOT `collective_service_items.category`. That column is free text with no
-- order, no rename and no reader. It is left in place, untouched, as the dead
-- column it already was; nothing reads it.
--
-- EXPAND-ONLY: one table, one nullable column on items, one nullable column on
-- collectives. Safe to apply before or after the code.

CREATE TABLE IF NOT EXISTS public.collective_service_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collective_id uuid NOT NULL REFERENCES public.venue_collectives (id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.collective_service_categories IS
  'Headings a combined booking page groups its offerings under, curated by the host '
  'venue. Ordered by sort_order. Deleting one leaves its offerings uncategorised.';

CREATE UNIQUE INDEX IF NOT EXISTS collective_service_categories_name_key
  ON public.collective_service_categories (collective_id, lower(btrim(name)));

CREATE INDEX IF NOT EXISTS idx_collective_service_categories_order
  ON public.collective_service_categories (collective_id, sort_order);

ALTER TABLE public.collective_service_items
  ADD COLUMN IF NOT EXISTS category_id uuid
    REFERENCES public.collective_service_categories (id) ON DELETE SET NULL;

COMMENT ON COLUMN public.collective_service_items.category_id IS
  'Heading on the combined page. NULL lists the offering under "Other services" when '
  'the page has headings, or flat when it has none. Supersedes the free-text category column.';

CREATE INDEX IF NOT EXISTS idx_collective_service_items_category
  ON public.collective_service_items (category_id)
  WHERE category_id IS NOT NULL;

ALTER TABLE public.venue_collectives
  ADD COLUMN IF NOT EXISTS categories_seeded_at timestamptz;

COMMENT ON COLUMN public.venue_collectives.categories_seeded_at IS
  'When the app first inherited headings from member venues for this page. NULL means '
  'the one-time seeding has not run; set once so a host who removes headings is not overruled.';

-- The collectives the caller hosts or is an active member of.
--
-- WHY A FUNCTION AND NOT THE SUBQUERIES the items table's policy uses. Those
-- subqueries read venue_collectives and venue_collective_members, whose own
-- staff policies read each other back (20260919120000, staff_select_collectives
-- and staff_select_collective_members), so any authenticated evaluation raises
-- "infinite recursion detected in policy". Nothing noticed because the app reads
-- every collective table through the service role; the pgTAP suite for this
-- table is the first thing to evaluate that chain as `authenticated`. SECURITY
-- DEFINER reads both tables as their owner, outside RLS, the same way
-- current_staff_venue_ids reads staff. Read-only and parameterised on the
-- caller's own identity, so it belongs on the client-executable allowlist
-- (scripts/check-client-executable-functions.mjs) beside the other RLS helpers.
--
-- Membership of ANY status counts, exactly as the older policies' subqueries
-- counted it, so 20270202140000 can rewrite those policies through this helper
-- without changing who can read what.
CREATE OR REPLACE FUNCTION public.current_staff_collective_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id FROM public.venue_collectives c
  WHERE c.host_venue_id IN (SELECT public.current_staff_venue_ids())
  UNION
  SELECT m.collective_id FROM public.venue_collective_members m
  WHERE m.venue_id IN (SELECT public.current_staff_venue_ids());
$$;

-- Whether a combined page is live and public (active, unified_catalog). Same
-- reason as above: the anonymous policy cannot subquery venue_collectives either,
-- because staff_select_collectives applies to every role and recurses through
-- the members table. Returns only what the public page already shows.
CREATE OR REPLACE FUNCTION public.collective_is_public_catalog(p_collective uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.venue_collectives c
    WHERE c.id = p_collective AND c.status = 'active' AND c.page_mode = 'unified_catalog'
  );
$$;

-- RLS mirrors collective_service_items in intent: staff of the host or any
-- member venue may read; the public policy covers active unified_catalog
-- collectives (defence in depth: the page renders through the admin client); the
-- service role does the writes on behalf of the host, gated in the catalogue
-- route.
ALTER TABLE public.collective_service_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff_select_collective_service_categories" ON public.collective_service_categories;
CREATE POLICY "staff_select_collective_service_categories"
  ON public.collective_service_categories FOR SELECT
  USING (collective_id IN (SELECT public.current_staff_collective_ids()));

DROP POLICY IF EXISTS "public_read_active_collective_service_categories" ON public.collective_service_categories;
CREATE POLICY "public_read_active_collective_service_categories"
  ON public.collective_service_categories FOR SELECT TO anon
  USING (public.collective_is_public_catalog(collective_id));

DROP POLICY IF EXISTS "service_role_collective_service_categories" ON public.collective_service_categories;
CREATE POLICY "service_role_collective_service_categories"
  ON public.collective_service_categories FOR ALL TO service_role USING (true) WITH CHECK (true);
