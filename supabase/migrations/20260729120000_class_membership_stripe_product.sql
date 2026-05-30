-- Stripe Product ID on venue membership products (Price IDs remain on stripe_price_id).
ALTER TABLE public.class_membership_products
  ADD COLUMN IF NOT EXISTS stripe_product_id text;

COMMENT ON COLUMN public.class_membership_products.stripe_product_id IS
  'Stripe Product id (prod_…) on the venue connected account; created by Resneo when staff saves a membership plan.';
