-- Reserve NI: Row-Level Security - staff can only read/write data for their venue(s)
-- Staff are identified by email from Supabase Auth JWT (auth.jwt() ->> 'email').
-- Idempotent: Supabase Preview / branched DBs may already have RLS enabled.

ALTER TABLE venues ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE guests ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff_select_own_venue" ON venues;
CREATE POLICY "staff_select_own_venue"
  ON venues FOR SELECT
  USING (
    id IN (
      SELECT venue_id FROM staff
      WHERE email = (auth.jwt() ->> 'email')
    )
  );

DROP POLICY IF EXISTS "staff_update_own_venue" ON venues;
CREATE POLICY "staff_update_own_venue"
  ON venues FOR UPDATE
  USING (
    id IN (
      SELECT venue_id FROM staff
      WHERE email = (auth.jwt() ->> 'email')
    )
  );

DROP POLICY IF EXISTS "staff_select_own" ON staff;
CREATE POLICY "staff_select_own"
  ON staff FOR SELECT
  USING (email = (auth.jwt() ->> 'email'));

DROP POLICY IF EXISTS "staff_manage_guests" ON guests;
CREATE POLICY "staff_manage_guests"
  ON guests FOR ALL
  USING (
    venue_id IN (
      SELECT venue_id FROM staff
      WHERE email = (auth.jwt() ->> 'email')
    )
  )
  WITH CHECK (
    venue_id IN (
      SELECT venue_id FROM staff
      WHERE email = (auth.jwt() ->> 'email')
    )
  );

DROP POLICY IF EXISTS "staff_manage_bookings" ON bookings;
CREATE POLICY "staff_manage_bookings"
  ON bookings FOR ALL
  USING (
    venue_id IN (
      SELECT venue_id FROM staff
      WHERE email = (auth.jwt() ->> 'email')
    )
  )
  WITH CHECK (
    venue_id IN (
      SELECT venue_id FROM staff
      WHERE email = (auth.jwt() ->> 'email')
    )
  );

DROP POLICY IF EXISTS "staff_select_events" ON events;
CREATE POLICY "staff_select_events"
  ON events FOR SELECT
  USING (
    venue_id IN (
      SELECT venue_id FROM staff
      WHERE email = (auth.jwt() ->> 'email')
    )
  );

DROP POLICY IF EXISTS "staff_insert_events" ON events;
CREATE POLICY "staff_insert_events"
  ON events FOR INSERT
  WITH CHECK (
    venue_id IN (
      SELECT venue_id FROM staff
      WHERE email = (auth.jwt() ->> 'email')
    )
  );
