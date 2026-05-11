-- Reserve NI: guests table (one record per guest per venue, matched by email/phone)
-- Idempotent: Supabase Preview / branched DBs may already include this table.

CREATE TABLE IF NOT EXISTS guests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES venues (id) ON DELETE CASCADE,
  name text,
  email text,
  phone text,
  global_guest_hash text,
  visit_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT guests_venue_email_unique UNIQUE (venue_id, email)
);

CREATE INDEX IF NOT EXISTS idx_guests_venue_id ON guests (venue_id);
CREATE INDEX IF NOT EXISTS idx_guests_venue_phone ON guests (venue_id, phone);
