-- Database-backed short URLs for SMS (and optionally email): /b/{code} → manage, confirm, or pay flows.

CREATE TABLE IF NOT EXISTS booking_short_links (
  code text PRIMARY KEY CHECK (char_length(code) >= 6 AND char_length(code) <= 12),
  venue_id uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('manage', 'confirm', 'payment')),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  access_count int NOT NULL DEFAULT 0,
  last_accessed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_short_links_active_booking_purpose
  ON booking_short_links (booking_id, purpose)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_booking_short_links_venue ON booking_short_links (venue_id);
CREATE INDEX IF NOT EXISTS idx_booking_short_links_booking ON booking_short_links (booking_id);

ALTER TABLE booking_short_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_booking_short_links"
  ON booking_short_links FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE booking_short_links IS 'Maps short /b/{code} paths to booking-scoped guest links for SMS segment savings.';
