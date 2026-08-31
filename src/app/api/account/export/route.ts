import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { buildAccountExport, accountExportFilename } from '@/lib/account/account-export';
import { checkRateLimit } from '@/lib/rate-limit';
import { NO_STORE_HEADERS } from '@/lib/api/error-codes';

/**
 * GET /api/account/export - everything this account can see, as one JSON file (P4-5).
 *
 * **A download, never an email.** Sending a personal-data archive to an inbox
 * puts a permanent copy somewhere ResNeo does not control and cannot withdraw,
 * and mail is forwarded, backed up and breached. The customer gets the file
 * from a request they made while signed in.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createRouteHandlerClient(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorised', code: 'UNAUTHENTICATED' },
        { status: 401, headers: NO_STORE_HEADERS },
      );
    }

    /*
      Limited PER USER rather than per IP, which is what this operation
      actually costs: it is several full-table reads for one account, so the
      thing worth bounding is how often one account can ask. Keying on IP would
      let somebody rotate addresses to keep asking, and would block a whole
      office from exporting because a colleague just did.
    */
    const limit = checkRateLimit(user.id, 'account-export', 3, 60 * 60_000);
    if (!limit.ok) {
      return NextResponse.json(
        {
          error: 'You have requested several exports recently. Please try again later.',
          code: 'RATE_LIMITED',
        },
        {
          status: 429,
          headers: { ...NO_STORE_HEADERS, 'Retry-After': String(limit.retryAfterSec) },
        },
      );
    }

    const now = new Date();
    const payload = await buildAccountExport(supabase, getSupabaseAdminClient(), user, now);

    return new NextResponse(JSON.stringify(payload, null, 2), {
      headers: {
        ...NO_STORE_HEADERS,
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${accountExportFilename(now)}"`,
      },
    });
  } catch (e) {
    console.error('[account/export]', e);
    return NextResponse.json(
      { error: 'Internal error', code: 'INTERNAL_ERROR' },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
