/**
 * A member's copy of a host's add-on group or form is the host's to change (plan §6.5, RT1-13;
 * APP-02). The engine's locks refuse the write (RN003, RN004); this answers first, in words, so a
 * member reads why instead of a failed save, from the dashboard or from the app.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { collectiveDbError } from '@/lib/linked-accounts/replicas/db-errors';

const REFUSALS = {
  addon_groups: 'RN003',
  compliance_types: 'RN004',
} as const;

/** The 409 for a managed row at `venueId`, or null when the row is the venue's own. */
export async function managedByCollectiveRefusal(
  admin: SupabaseClient,
  table: keyof typeof REFUSALS,
  id: string,
  venueId: string,
): Promise<NextResponse | null> {
  const { data: row } = await admin
    .from(table)
    .select('managed_by_collective_id')
    .eq('id', id)
    .eq('venue_id', venueId)
    .maybeSingle();
  const collectiveId = (row as { managed_by_collective_id?: string | null } | null)?.managed_by_collective_id;
  if (!collectiveId) return null;
  const { data: collective } = await admin
    .from('venue_collectives')
    .select('name, host_venue_id, status')
    .eq('id', collectiveId)
    .maybeSingle();
  if (!collective || collective.status !== 'active') return null;
  const { data: host } = await admin.from('venues').select('name').eq('id', collective.host_venue_id as string).maybeSingle();
  const coded = collectiveDbError(
    { code: REFUSALS[table], message: 'managed' },
    { collective: (collective.name as string | null) ?? undefined, host: (host?.name as string | null) ?? undefined },
  )!;
  return NextResponse.json(coded.body, { status: coded.status });
}
