-- Reserve NI: venues table (core venue profile)
-- Idempotent: Supabase Preview / branched DBs may already include this table.

CREATE TABLE IF NOT EXISTS venues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  address text,
  phone text,
  email text,
  cover_photo_url text,
  opening_hours jsonb,
  booking_rules jsonb,
  deposit_config jsonb,
  availability_config jsonb,
  timezone text NOT NULL DEFAULT 'Europe/London',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_venues_slug ON venues (slug);
