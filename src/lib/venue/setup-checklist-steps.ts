/**
 * Setup checklist rows a staff member may snooze with "Not now".
 *
 * Kept in its own module (rather than in `compute-setup-status.ts`) so the client
 * checklist component and the snooze API route can both import the value without
 * pulling the Stripe / Supabase admin server code into the browser bundle.
 *
 * A snoozed row is hidden from the checklist and stops blocking the card from
 * auto-hiding, so only steps a venue can legitimately never do belong here.
 */
export const OPTIONAL_SETUP_STEP_KEYS = ['stripe_connected', 'first_booking_made'] as const;

export type OptionalSetupStepKey = (typeof OPTIONAL_SETUP_STEP_KEYS)[number];

export function isOptionalSetupStepKey(value: unknown): value is OptionalSetupStepKey {
  return (
    typeof value === 'string' &&
    (OPTIONAL_SETUP_STEP_KEYS as readonly string[]).includes(value)
  );
}
