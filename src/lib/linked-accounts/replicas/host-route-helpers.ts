/**
 * Shared checks for the host's collective routes (plan Appendix E contracts 1, 2 and 14; W5).
 *
 * Every one of them is the host of an active collective on the replicas model acting on its own
 * collective. The engine re-checks all of it as defence in depth (§6.4), but a route that has
 * checked first can answer in plain words instead of a 500.
 */
import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { apiError } from '@/lib/api/error-codes';
import { collectiveDbError, type CollectiveNames } from '@/lib/linked-accounts/replicas/db-errors';

export interface HostedReplicasCollective {
  id: string;
  name: string;
  hostVenueId: string;
}

type HostCheck =
  | { ok: true; collective: HostedReplicasCollective }
  | { ok: false; response: NextResponse };

/**
 * The collective `collectiveId`, when the caller's venue hosts it, it is active and it is on the
 * replicas model. Anything else is a coded answer the page can show as it is.
 */
export async function requireReplicasHost(
  admin: SupabaseClient,
  collectiveId: string,
  venueId: string,
): Promise<HostCheck> {
  const { data } = await admin
    .from('venue_collectives')
    .select('*')
    .eq('id', collectiveId)
    .maybeSingle();
  const row = data as Record<string, unknown> | null;
  if (!row) {
    return { ok: false, response: NextResponse.json({ error: 'Collective not found.' }, { status: 404 }) };
  }
  const name = (row.name as string) ?? 'your collective';
  if (row.host_venue_id !== venueId || row.status !== 'active') {
    return {
      ok: false,
      response: NextResponse.json(
        apiError(`Only ${name}'s host can do this.`, 'COLLECTIVE_NOT_HOST'),
        { status: 403 },
      ),
    };
  }
  if (row.service_model !== 'replicas') {
    return {
      ok: false,
      response: NextResponse.json(
        apiError(
          `${name} has not moved to shared services yet, so this is not available.`,
          'COLLECTIVE_LEGACY_MODEL',
        ),
        { status: 409 },
      ),
    };
  }
  return { ok: true, collective: { id: collectiveId, name, hostVenueId: venueId } };
}

/**
 * Turn an engine refusal into the coded answer the page shows, or a 500 for anything the routes are
 * meant to have checked first (GRD-04): an unlisted raise is a bug to page on, not prose to invent.
 */
export function engineErrorResponse(
  error: { code?: string | null; message?: string | null } | null | undefined,
  names: CollectiveNames,
  fallback: string,
): NextResponse {
  const coded = collectiveDbError(error, names);
  if (coded) return NextResponse.json(coded.body, { status: coded.status });
  console.error('[collective] engine call failed:', error?.code, error?.message);
  return NextResponse.json({ error: fallback }, { status: 500 });
}
