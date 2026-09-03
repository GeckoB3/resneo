-- Service categories: group a venue's appointment services on the booking pages.
--
-- WHAT IT IS FOR. A venue with a long service menu (a salon with forty services
-- across hair, nails and beauty) needs its public booking page and its staff
-- booking flow to list services under headings the customer can jump between,
-- rather than one flat list. Owners create categories on the Services page,
-- assign each service to one, and drag the categories into the order the
-- booking page shows them. See Docs/service-categories-plan.md.
--
-- WHY A TABLE AND NOT A TEXT COLUMN. `collective_service_items.category` is
-- free text and it shows: nothing orders it, nothing renames it consistently,
-- and nothing renders it. A row per category gives an order to drag, a name to
-- rename once, and a foreign key so a service can never point at a category
-- that no longer exists.
--
-- EXPAND-ONLY. A new table and one nullable column with no CHECK on existing
-- rows. Production can apply this before the code that uses it arrives, and
-- the code tolerates the table being absent (reads fall back to "no
-- categories"), so either order is safe.
--
-- Only `service_items` gains the column. Every live venue is on unified
-- scheduling; the legacy `appointment_services` table is not extended.

CREATE TABLE IF NOT EXISTS public.service_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES public.venues (id) ON DELETE CASCADE,
  -- Trimmed and bounded here so a blank or runaway name is refused at the
  -- database even if a client bypasses the route's validation.
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  -- Position on the booking page, lower first. Written as `index` by
  -- PUT /api/venue/service-categories/reorder, the same idiom as services.
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.service_categories IS
  'Headings a venue groups its appointment services under on the booking pages. '
  'Ordered by sort_order. Deleting one leaves its services uncategorised '
  '(service_items.category_id ON DELETE SET NULL); it never deletes a service.';

-- Two categories that differ only by case or surrounding space are one
-- category typed twice; refuse the second so the booking page never shows
-- "Hair" and "hair" as separate headings.
CREATE UNIQUE INDEX IF NOT EXISTS service_categories_venue_name_key
  ON public.service_categories (venue_id, lower(btrim(name)));

CREATE INDEX IF NOT EXISTS idx_service_categories_venue_order
  ON public.service_categories (venue_id, sort_order);

ALTER TABLE public.service_items
  ADD COLUMN IF NOT EXISTS category_id uuid
    REFERENCES public.service_categories (id) ON DELETE SET NULL;

COMMENT ON COLUMN public.service_items.category_id IS
  'Optional category heading on the booking pages. NULL lists the service under '
  '"Other services" when the venue has categories, or in the flat list when it has none.';

CREATE INDEX IF NOT EXISTS idx_service_items_category
  ON public.service_items (category_id)
  WHERE category_id IS NOT NULL;

-- RLS mirrors service_items: a venue's staff manage their own rows, the
-- service role (every API route) sees everything, and there is no anonymous
-- policy because the public booking page reads categories through the admin
-- client, exactly as it reads services since 20270113120000 dropped
-- public_read_service_items.
ALTER TABLE public.service_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff_manage_service_categories" ON public.service_categories;
CREATE POLICY "staff_manage_service_categories"
  ON public.service_categories
  FOR ALL
  USING (
    venue_id IN (SELECT venue_id FROM public.staff WHERE email = auth.jwt() ->> 'email')
  )
  WITH CHECK (
    venue_id IN (SELECT venue_id FROM public.staff WHERE email = auth.jwt() ->> 'email')
  );

DROP POLICY IF EXISTS "service_role_service_categories" ON public.service_categories;
CREATE POLICY "service_role_service_categories"
  ON public.service_categories
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
