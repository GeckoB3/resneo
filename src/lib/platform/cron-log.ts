import type { NextRequest } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';

const MAX_DETAIL_CHARS = 600;

/**
 * Wrap a cron route handler so every authorised run is recorded in `cron_runs`
 * (success, duration, response detail) for the platform system health page.
 *
 * Usage:
 *   export const POST = withCronRunLogging('sales-monthly', async (request) => { ... });
 */
export function withCronRunLogging(
  jobName: string,
  handler: (request: NextRequest) => Promise<Response>,
): (request: NextRequest) => Promise<Response> {
  return async (request: NextRequest): Promise<Response> => {
    const startedAt = new Date();
    let response: Response;
    let thrown: unknown = null;

    try {
      response = await handler(request);
    } catch (e) {
      thrown = e;
      response = new Response(JSON.stringify({ error: 'Internal error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Don't log unauthorised probes — only real (authorised) cron executions.
    if (response.status !== 401 && response.status !== 403) {
      const durationMs = Date.now() - startedAt.getTime();
      let detail: string | null = null;
      try {
        detail = (await response.clone().text()).slice(0, MAX_DETAIL_CHARS);
      } catch {
        detail = null;
      }
      if (thrown) {
        const msg = thrown instanceof Error ? thrown.message : String(thrown);
        detail = `threw: ${msg}`.slice(0, MAX_DETAIL_CHARS);
      }

      try {
        const admin = getSupabaseAdminClient();
        const { error } = await admin.from('cron_runs').insert({
          job_name: jobName,
          started_at: startedAt.toISOString(),
          finished_at: new Date().toISOString(),
          duration_ms: durationMs,
          ok: response.status >= 200 && response.status < 300,
          status_code: response.status,
          detail,
        });
        if (error) {
          console.error('[cron-log] insert failed:', error.message, { jobName });
        }
      } catch (e) {
        console.error('[cron-log] unexpected failure:', e, { jobName });
      }
    }

    if (thrown) {
      console.error(`[cron ${jobName}] handler threw:`, thrown);
    }
    return response;
  };
}
