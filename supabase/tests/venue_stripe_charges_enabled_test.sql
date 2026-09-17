-- Resneo: venues remember whether Stripe can take charges (20270213120000; plan W1a, RT2-15).
--
-- Proves:
--   * the column starts NULL (unknown);
--   * the server (no client role) can record TRUE and FALSE;
--   * a new connected account id resets the answer to NULL, unless the same statement sets it;
--   * a client role cannot change it (the stored value is kept, the rest of the save lands),
--     or set it on insert.
--
-- Run with:  supabase test db
-- Each test file runs inside a transaction that is rolled back afterwards.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(7);

INSERT INTO public.venues (id, name, slug, email, pricing_tier, plan_status, booking_model, stripe_connected_account_id)
VALUES ('00000000-0000-0000-0000-00000000c5f1', 'Stripe Ready Venue', 'stripe-ready-venue',
        'venue@stripe-ready.test', 'appointments', 'active', 'unified_scheduling', 'acct_test_one');

SELECT is(
  (SELECT stripe_charges_enabled FROM public.venues WHERE id = '00000000-0000-0000-0000-00000000c5f1'),
  NULL, 'A venue starts with its Stripe readiness unknown');

UPDATE public.venues SET stripe_charges_enabled = true WHERE id = '00000000-0000-0000-0000-00000000c5f1';
SELECT is(
  (SELECT stripe_charges_enabled FROM public.venues WHERE id = '00000000-0000-0000-0000-00000000c5f1'),
  true, 'The server records that the account can take charges');

UPDATE public.venues SET name = 'Stripe Ready Venue (renamed)' WHERE id = '00000000-0000-0000-0000-00000000c5f1';
SELECT is(
  (SELECT stripe_charges_enabled FROM public.venues WHERE id = '00000000-0000-0000-0000-00000000c5f1'),
  true, 'An unrelated edit keeps the answer');

UPDATE public.venues SET stripe_connected_account_id = 'acct_test_two' WHERE id = '00000000-0000-0000-0000-00000000c5f1';
SELECT is(
  (SELECT stripe_charges_enabled FROM public.venues WHERE id = '00000000-0000-0000-0000-00000000c5f1'),
  NULL, 'A new connected account does not inherit the old answer');

UPDATE public.venues SET stripe_connected_account_id = 'acct_test_three', stripe_charges_enabled = false
WHERE id = '00000000-0000-0000-0000-00000000c5f1';
SELECT is(
  (SELECT stripe_charges_enabled FROM public.venues WHERE id = '00000000-0000-0000-0000-00000000c5f1'),
  false, 'The server may set the account and its answer together');

-- Act as a signed-in client request (RLS is bypassed by the test session; the trigger reads the claim).
SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', true);

UPDATE public.venues SET stripe_charges_enabled = true, name = 'Client save'
WHERE id = '00000000-0000-0000-0000-00000000c5f1';
SELECT is(
  (SELECT array[stripe_charges_enabled::text, name] FROM public.venues WHERE id = '00000000-0000-0000-0000-00000000c5f1'),
  array['false', 'Client save'],
  'A client cannot mark its own venue as able to take payments, and the rest of its save lands');

INSERT INTO public.venues (id, name, slug, email, pricing_tier, plan_status, booking_model, stripe_charges_enabled)
VALUES ('00000000-0000-0000-0000-00000000c5f2', 'Client Venue', 'client-venue-stripe',
        'venue@client-stripe.test', 'appointments', 'active', 'unified_scheduling', true);
SELECT is(
  (SELECT stripe_charges_enabled FROM public.venues WHERE id = '00000000-0000-0000-0000-00000000c5f2'),
  NULL, 'A client insert cannot set it either');

SELECT * FROM finish();

ROLLBACK;
