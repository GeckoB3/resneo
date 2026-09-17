import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import type { AdoptionContext } from '@/lib/linked-accounts/replicas/adoptions';

/** The calling venue must be an active member of a live shared-services collective (contract 10). */
export async function memberAdoptionContext(
  admin: SupabaseClient,
  collectiveId: string,
  venueId: string,
  userId: string | null,
): Promise<{ ok: true; ctx: AdoptionContext } | { ok: false; response: NextResponse }> {
  const [{ data: collective }, { data: membership }] = await Promise.all([
    admin.from('venue_collectives').select('name, host_venue_id, status, service_model').eq('id', collectiveId).maybeSingle(),
    admin
      .from('venue_collective_members')
      .select('id')
      .eq('collective_id', collectiveId)
      .eq('venue_id', venueId)
      .eq('status', 'active')
      .maybeSingle(),
  ]);
  if (!collective || collective.status !== 'active' || !membership) {
    return { ok: false, response: NextResponse.json({ error: 'Your venue is not part of this collective.' }, { status: 404 }) };
  }
  if (collective.service_model !== 'replicas') {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'This collective does not use shared services yet.', code: 'COLLECTIVE_LEGACY_MODEL' },
        { status: 409 },
      ),
    };
  }
  const { data: host } = await admin.from('venues').select('name').eq('id', collective.host_venue_id as string).maybeSingle();
  return {
    ok: true,
    ctx: {
      admin,
      collectiveId,
      collectiveName: (collective.name as string) ?? 'your collective',
      hostVenueId: collective.host_venue_id as string,
      hostVenueName: (host?.name as string | undefined) ?? 'The host',
      venueId,
      userId,
    },
  };
}
