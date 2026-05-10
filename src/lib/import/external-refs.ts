import type { SupabaseClient } from '@supabase/supabase-js';

/** Provider slug stored in `external_record_refs.provider` for Phorest CSV/API-shaped imports. */
export const IMPORT_REF_PROVIDER_PHOREST = 'phorest';

export async function findGuestIdByExternalRef(
  admin: SupabaseClient,
  venueId: string,
  provider: string,
  externalId: string,
): Promise<string | null> {
  const id = externalId.trim();
  if (!id) return null;
  const { data, error } = await admin
    .from('external_record_refs')
    .select('entity_id')
    .eq('venue_id', venueId)
    .eq('provider', provider)
    .eq('entity_type', 'guest')
    .eq('external_id', id)
    .maybeSingle();
  if (error) {
    console.error('[import external_record_refs] findGuestIdByExternalRef', error);
    return null;
  }
  return (data as { entity_id?: string } | null)?.entity_id ?? null;
}

export async function findBookingIdByExternalRef(
  admin: SupabaseClient,
  venueId: string,
  provider: string,
  externalId: string,
): Promise<string | null> {
  const id = externalId.trim();
  if (!id) return null;
  const { data, error } = await admin
    .from('external_record_refs')
    .select('entity_id')
    .eq('venue_id', venueId)
    .eq('provider', provider)
    .eq('entity_type', 'booking')
    .eq('external_id', id)
    .maybeSingle();
  if (error) {
    console.error('[import external_record_refs] findBookingIdByExternalRef', error);
    return null;
  }
  return (data as { entity_id?: string } | null)?.entity_id ?? null;
}

export async function upsertGuestExternalRef(
  admin: SupabaseClient,
  venueId: string,
  guestId: string,
  provider: string,
  externalId: string,
  sourcePayload?: Record<string, unknown>,
): Promise<void> {
  const id = externalId.trim();
  if (!id) return;
  const row = {
    venue_id: venueId,
    provider,
    entity_type: 'guest' as const,
    entity_id: guestId,
    external_id: id,
    source_payload: sourcePayload ?? {},
  };
  const { error } = await admin.from('external_record_refs').upsert(row, {
    onConflict: 'venue_id,provider,entity_type,external_id',
  });
  if (error) console.error('[import external_record_refs] upsertGuestExternalRef', error);
}

export async function insertBookingExternalRef(
  admin: SupabaseClient,
  venueId: string,
  bookingId: string,
  provider: string,
  externalId: string,
  payload?: Record<string, unknown>,
): Promise<boolean> {
  const id = externalId.trim();
  if (!id) return true;
  const { error } = await admin.from('external_record_refs').insert({
    venue_id: venueId,
    provider,
    entity_type: 'booking',
    entity_id: bookingId,
    external_id: id,
    source_payload: payload ?? {},
  });
  if (error) {
    console.error('[import external_record_refs] insertBookingExternalRef', error);
    return false;
  }
  return true;
}
