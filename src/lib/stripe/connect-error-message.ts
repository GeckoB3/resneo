/**
 * Map an error thrown while starting Stripe Connect onboarding into a clear,
 * admin-facing message.
 *
 * Stripe surfaces actionable config/credential problems (invalid/rotated API key,
 * unknown account, etc.) in `error.message`, and these routes are operator-facing,
 * so by default we show the real reason rather than a generic 500.
 *
 * One case gets special handling: Stripe blocks creating LIVE connected accounts
 * until the platform profile's "responsibilities of managing losses" step is
 * completed AND Stripe has finished reviewing it. Both states surface the same raw
 * error pointing at the platform profile, which is confusing for an admin who has
 * already completed it, so we replace it with one plain message that covers both.
 */
export const STRIPE_PLATFORM_PROFILE_MESSAGE =
  'Stripe is still getting your account ready for live payments. If you have just completed your Stripe platform profile, Stripe is reviewing it (usually a day or two) and you will be able to connect as soon as they approve it. If you have not completed it yet, finish the managing losses step in your Stripe settings at https://dashboard.stripe.com/settings/connect/platform-profile.';

/** True when a Stripe message is the platform-profile / managing-losses gate (incomplete or under review). */
export function isPlatformProfileError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('managing losses') ||
    m.includes('connect/platform-profile') ||
    m.includes('platform profile')
  );
}

export function describeStripeConnectError(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { type?: unknown; message?: unknown };
    if (
      typeof e.type === 'string' &&
      e.type.startsWith('Stripe') &&
      typeof e.message === 'string' &&
      e.message.trim()
    ) {
      if (isPlatformProfileError(e.message)) {
        return STRIPE_PLATFORM_PROFILE_MESSAGE;
      }
      return `Stripe error: ${e.message}`;
    }
  }
  return 'Internal server error';
}
