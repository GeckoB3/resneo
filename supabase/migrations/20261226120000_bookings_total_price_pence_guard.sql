-- Guard: ensure bookings.booking_total_price_pence exists.
--
-- This column is read/written by core booking creation
-- (src/app/api/booking/create/route.ts, src/app/api/venue/bookings/route.ts) and
-- by communications pricing (src/lib/communications/booking-confirmation-pricing.ts),
-- and the data-import executor now writes it for imported bookings so imported
-- revenue is visible to reporting. No prior migration added it, so fresh/branch
-- databases (Supabase Preview) could be missing it, which would break the import
-- RPC's dynamic INSERT. Idempotent: a no-op where the column already exists.
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS booking_total_price_pence int;
