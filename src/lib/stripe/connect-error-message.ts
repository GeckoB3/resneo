/**
 * Map an error thrown while starting Stripe Connect onboarding into a short,
 * user-facing message. Live venue admins see these, so they stay deliberately
 * brief. The route logs the full Stripe error server-side, and the short `ref`
 * token in each message is enough for us to identify the cause from a report.
 *
 * The platform-profile / managing-losses case gets its own ref because Stripe
 * returns it both when that step is incomplete and while it is under review.
 */
export const STRIPE_PLATFORM_PROFILE_MESSAGE =
  'Payment setup is not ready yet. Please try again later. (ref: connect-not-ready)';

export const STRIPE_GENERIC_ERROR_MESSAGE =
  'We could not start payment setup. Please try again. (ref: connect-stripe)';

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
      return STRIPE_GENERIC_ERROR_MESSAGE;
    }
  }
  return 'Internal server error';
}
