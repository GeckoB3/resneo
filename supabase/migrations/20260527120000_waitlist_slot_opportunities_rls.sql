-- Staff-only waitlist slot alerts: enable RLS (table was created without policies in 20260523120000).

ALTER TABLE public.waitlist_slot_opportunities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff_manage_waitlist_slot_opportunities" ON public.waitlist_slot_opportunities;
CREATE POLICY "staff_manage_waitlist_slot_opportunities"
  ON public.waitlist_slot_opportunities
  FOR ALL
  USING (
    venue_id IN (
      SELECT venue_id FROM public.staff
      WHERE email = (auth.jwt() ->> 'email')
    )
  )
  WITH CHECK (
    venue_id IN (
      SELECT venue_id FROM public.staff
      WHERE email = (auth.jwt() ->> 'email')
    )
  );

COMMENT ON TABLE public.waitlist_slot_opportunities IS
  'Staff-facing alerts when appointment availability opens and waitlist mode is staff_choose. RLS: venue staff only; server cron/API uses service role.';
