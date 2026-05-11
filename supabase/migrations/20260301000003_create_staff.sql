-- Reserve NI: staff table (venue staff, linked to Supabase Auth by email)
-- Idempotent: Supabase Preview / branched DBs may already include this table.

CREATE TABLE IF NOT EXISTS staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES venues (id) ON DELETE CASCADE,
  email text NOT NULL,
  name text,
  role staff_role NOT NULL DEFAULT 'staff',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_staff_venue_id ON staff (venue_id);
CREATE INDEX IF NOT EXISTS idx_staff_email ON staff (email);

-- One email can be staff at multiple venues; no unique on email alone
