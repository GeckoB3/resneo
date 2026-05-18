/**
 * Shared cron completion helper — surfaces failures to Sentry (and optional ops email).
 *
 * `account-link-maintenance` result counters (for dashboards / log alerts):
 * - expired_requests — pending requests past 30 days
 * - lapse_warnings — 7-day subscription lapse emails sent
 * - suspended — accepted links moved to suspended (partner lapsed)
 * - resumed — suspended links restored to accepted
 * - expired_suspended — suspended >30 days → expired
 * - terminated_ineligible — plan/tier no longer supports links
 * - errors — per-row or step failures (alert when > 0)
 */

import { sendEmail } from '@/lib/emails/send-email';

export interface CronRunReport {
  /** Stable job id, e.g. account-link-maintenance */
  job: string;
  results: Record<string, number>;
  errors: number;
}

export interface CronFinalizeOutcome {
  ok: boolean;
  httpStatus: number;
  body: Record<string, unknown>;
}

function opsAlertEmail(): string | null {
  const raw =
    process.env.CRON_ALERT_EMAIL?.trim() || process.env.OPS_ALERT_EMAIL?.trim() || '';
  return raw || null;
}

/**
 * When `errors > 0`, capture to Sentry and optionally email ops. Always returns a JSON body
 * with `ok: errors === 0` so uptime monitors can alert on `ok: false`.
 */
export async function finalizeCronRun(report: CronRunReport): Promise<CronFinalizeOutcome> {
  const { job, results, errors } = report;
  const ok = errors === 0;
  const body: Record<string, unknown> = { ok, job, errors, ...results };

  if (!ok) {
    const summary = `[cron] ${job} finished with ${errors} error(s): ${JSON.stringify(results)}`;
    console.error(summary);
    try {
      const Sentry = await import('@sentry/nextjs');
      Sentry.captureMessage(summary, {
        level: 'error',
        tags: { cron_job: job },
        extra: { results, errors },
      });
    } catch (sentryErr) {
      console.error('[cron] Sentry capture failed:', sentryErr);
    }

    const opsTo = opsAlertEmail();
    if (opsTo) {
      try {
        await sendEmail({
          to: opsTo,
          subject: `ReserveNI cron alert: ${job}`,
          html: `<p>${summary}</p><pre>${JSON.stringify(results, null, 2)}</pre>`,
          text: `${summary}\n\n${JSON.stringify(results, null, 2)}`,
        });
      } catch (mailErr) {
        console.error('[cron] ops alert email failed:', mailErr);
      }
    }
  }

  return {
    ok,
    httpStatus: ok ? 200 : 500,
    body,
  };
}
