/**
 * Reporting for schedule reads that fail open.
 *
 * Every availability fetcher issues its queries inside a `Promise.all` and then
 * reads `res.data ?? []`. When one of those queries fails, the substituted empty
 * array is indistinguishable from a genuine "nothing here" answer: "I could not
 * read the leave table" becomes "nobody is on leave", and the engine sells the
 * day. Nothing in production would tell you it had happened.
 *
 * This does not change that behaviour. It makes it visible, which has to come
 * first: failing closed needs the third `unavailable` state and a booking UI
 * that can render it, and neither exists yet.
 *
 * `assumed` is required rather than optional on purpose. It forces the call
 * site to state what the engine now believes, which is the difference between
 * an alert someone can act on and one they scroll past.
 */

export interface AvailabilityReadFailureContext {
  /** Function that issued the query, e.g. `fetchAppointmentInput`. */
  source: string;
  /** Table that could not be read, e.g. `practitioner_leave_periods`. */
  table: string;
  /** What the caller substituted, phrased as the belief it creates. */
  assumed: string;
  venueId?: string | null;
  calendarId?: string | null;
  practitionerId?: string | null;
  /** A single date, or a month range as `start..end`. */
  date?: string | null;
}

/** The shape PostgREST returns. Not an `Error`, which is why one is built below. */
export interface ReadError {
  message?: string | null;
  code?: string | null;
  details?: string | null;
  hint?: string | null;
}

function sentryDsn(): string | undefined {
  return process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;
}

async function captureToSentry(
  context: AvailabilityReadFailureContext,
  error: ReadError | null | undefined,
  message: string,
): Promise<void> {
  try {
    const Sentry = await import('@sentry/nextjs');
    Sentry.captureException(new Error(`Availability read failed: ${context.table} (${message})`), {
      level: 'error',
      tags: {
        availability_read_source: context.source,
        availability_read_table: context.table,
      },
      // Group by the site rather than by the database's message text, so a
      // transient wobble and a persistent outage land in one issue per site.
      fingerprint: ['availability-read-failure', context.source, context.table],
      extra: {
        assumed: context.assumed,
        venueId: context.venueId ?? null,
        calendarId: context.calendarId ?? null,
        practitionerId: context.practitionerId ?? null,
        date: context.date ?? null,
        code: error?.code ?? null,
        details: error?.details ?? null,
        hint: error?.hint ?? null,
      },
    });
  } catch {
    // Reporting must never be the reason a booking lookup fails.
  }
}

/**
 * Records a schedule read that failed and was substituted with an empty result.
 *
 * Keeps the existing `[source] table: message` warning so anything grepping
 * logs for it keeps working, and adds a Sentry event when a DSN is configured.
 * Never throws.
 */
export function reportAvailabilityReadFailure(
  context: AvailabilityReadFailureContext,
  error: ReadError | null | undefined,
): void {
  const message = error?.message ?? 'unknown error';
  console.warn(`[${context.source}] ${context.table}: ${message}`);

  // Browser bundles must not pull in the Sentry SDK from the engine, and with no
  // DSN configured `sentry.server.config.ts` never called `init`, so there is
  // nothing to report to.
  if (typeof window !== 'undefined' || !sentryDsn()) return;

  void captureToSentry(context, error, message);
}

/**
 * Reports every failed read in one `Promise.all` batch.
 *
 * Written as a table so the full set of fail-open reads at a fetcher is visible
 * in one place. The audit's count of these was low because it counted the ones
 * that already logged; the ones that did not were the more dangerous half.
 */
export function reportAvailabilityReadFailures(
  source: string,
  context: Omit<AvailabilityReadFailureContext, 'source' | 'table' | 'assumed'>,
  reads: ReadonlyArray<{ table: string; assumed: string; error: ReadError | null }>,
): void {
  for (const read of reads) {
    if (!read.error) continue;
    reportAvailabilityReadFailure(
      { source, table: read.table, assumed: read.assumed, ...context },
      read.error,
    );
  }
}
