-- Reserve NI: bookings table
-- Idempotent: Supabase Preview / branched DBs may already include this table.

CREATE TABLE IF NOT EXISTS bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES venues (id) ON DELETE CASCADE,
  guest_id uuid NOT NULL REFERENCES guests (id) ON DELETE RESTRICT,
  booking_date date NOT NULL,
  booking_time time NOT NULL,
  party_size int NOT NULL,
  status booking_status NOT NULL DEFAULT 'Pending',
  source booking_source NOT NULL,
  dietary_notes text,
  occasion text,
  special_requests text,
  deposit_amount_pence int,
  deposit_status deposit_status NOT NULL DEFAULT 'Pending',
  stripe_payment_intent_id text,
  cancellation_deadline timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bookings_venue_id ON bookings (venue_id);
CREATE INDEX IF NOT EXISTS idx_bookings_venue_date ON bookings (venue_id, booking_date);
CREATE INDEX IF NOT EXISTS idx_bookings_guest_id ON bookings (guest_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings (venue_id, status);
