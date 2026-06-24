/**
 * Sync (upsert) the ticket-type rows for an experience event on edit.
 *
 * Historically a PATCH deleted every `event_ticket_types` row for the event and
 * re-inserted from the request body, minting fresh ids on every save. Because
 * `booking_ticket_lines.ticket_type_id` is `ON DELETE SET NULL`, that silently
 * nulled the tier reference on every existing sale — which (a) frees the
 * per-tier capacity the availability engine derives from those lines and (b)
 * destroys the price/tier provenance the roster reads (see the CDE review,
 * finding C3). This helper replaces delete+recreate with an upsert-by-id:
 *
 *   - Existing tiers are updated in place (matched by the `id` the client sends,
 *     or, for older clients that omit ids, by an unambiguous tier `name`).
 *   - Genuinely new tiers are inserted.
 *   - Tiers removed by the edit are deleted ONLY when no `booking_ticket_lines`
 *     reference them; a removed tier that has sales is left untouched so its
 *     historical bookings keep a valid `ticket_type_id`. There is no soft-delete
 *     column on `event_ticket_types`, so "keep" is the safe choice.
 *
 * Used by both PATCH paths (the collection route and the `[id]` route) so the
 * two audiences cannot diverge.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface EventTicketTypeInput {
  /** Present when the client round-trips an existing tier; absent for new tiers. */
  id?: string | null;
  name: string;
  price_pence: number;
  capacity?: number | null;
  sort_order?: number;
}

export interface SyncEventTicketTypesResult {
  ok: boolean;
  /** Tier ids that were intentionally removed but kept because they have sales. */
  retainedWithSales: string[];
  error?: string;
}

interface ExistingTierRow {
  id: string;
  name: string;
}

/**
 * Reconcile `event_ticket_types` for `eventId` against the tiers in `incoming`.
 *
 * Caller is responsible for auth + venue ownership of `eventId`; this only
 * touches `event_ticket_types` / reads `booking_ticket_lines`.
 */
export async function syncEventTicketTypes(
  admin: SupabaseClient,
  eventId: string,
  incoming: EventTicketTypeInput[],
): Promise<SyncEventTicketTypesResult> {
  const { data: existingRows, error: existingErr } = await admin
    .from('event_ticket_types')
    .select('id, name')
    .eq('event_id', eventId);

  if (existingErr) {
    console.error('[syncEventTicketTypes] load existing tiers failed:', existingErr);
    return { ok: false, retainedWithSales: [], error: 'Failed to load ticket types' };
  }

  const existing = (existingRows ?? []) as ExistingTierRow[];
  const existingById = new Map(existing.map((r) => [r.id, r]));
  // Name fallback only maps when the name is unique among existing tiers, so an
  // id-less client edit (the current EventManagerView) updates in place instead
  // of orphaning. Ambiguous duplicate names fall through to insert (safe).
  const nameCounts = new Map<string, number>();
  for (const r of existing) nameCounts.set(r.name, (nameCounts.get(r.name) ?? 0) + 1);
  const uniqueNameToId = new Map<string, string>();
  for (const r of existing) {
    if (nameCounts.get(r.name) === 1) uniqueNameToId.set(r.name, r.id);
  }

  const matchedExistingIds = new Set<string>();
  const toUpdate: Array<{ id: string; row: Record<string, unknown> }> = [];
  const toInsert: Array<Record<string, unknown>> = [];

  incoming.forEach((tt, i) => {
    const row = {
      event_id: eventId,
      name: tt.name,
      price_pence: tt.price_pence,
      capacity: tt.capacity ?? null,
      sort_order: tt.sort_order ?? i,
    };

    let matchId: string | undefined;
    if (tt.id && existingById.has(tt.id) && !matchedExistingIds.has(tt.id)) {
      matchId = tt.id;
    } else if (!tt.id) {
      const byName = uniqueNameToId.get(tt.name);
      if (byName && !matchedExistingIds.has(byName)) matchId = byName;
    }

    if (matchId) {
      matchedExistingIds.add(matchId);
      toUpdate.push({ id: matchId, row });
    } else {
      // Unknown / already-claimed id, or a brand-new tier: insert fresh.
      toInsert.push(row);
    }
  });

  // Update existing tiers in place (preserves their id, so booking_ticket_lines stay valid).
  for (const { id, row } of toUpdate) {
    const { error } = await admin.from('event_ticket_types').update(row).eq('id', id).eq('event_id', eventId);
    if (error) {
      console.error('[syncEventTicketTypes] update tier failed:', error);
      return { ok: false, retainedWithSales: [], error: 'Failed to update ticket types' };
    }
  }

  if (toInsert.length > 0) {
    const { error } = await admin.from('event_ticket_types').insert(toInsert);
    if (error) {
      console.error('[syncEventTicketTypes] insert tiers failed:', error);
      return { ok: false, retainedWithSales: [], error: 'Failed to add ticket types' };
    }
  }

  // Tiers present before but not matched by this edit are candidates for removal.
  const removedIds = existing.filter((r) => !matchedExistingIds.has(r.id)).map((r) => r.id);
  const retainedWithSales: string[] = [];
  if (removedIds.length > 0) {
    const { data: soldLines, error: soldErr } = await admin
      .from('booking_ticket_lines')
      .select('ticket_type_id')
      .in('ticket_type_id', removedIds);

    if (soldErr) {
      console.error('[syncEventTicketTypes] sales lookup failed:', soldErr);
      return { ok: false, retainedWithSales: [], error: 'Failed to verify ticket sales' };
    }

    const soldTierIds = new Set(
      (soldLines ?? []).map((l) => (l as { ticket_type_id: string | null }).ticket_type_id).filter(Boolean) as string[],
    );
    const deletableIds = removedIds.filter((id) => !soldTierIds.has(id));
    for (const id of removedIds) {
      if (soldTierIds.has(id)) retainedWithSales.push(id);
    }

    // Never orphan booking_ticket_lines: only delete tiers with zero sales.
    if (deletableIds.length > 0) {
      const { error: delErr } = await admin
        .from('event_ticket_types')
        .delete()
        .in('id', deletableIds)
        .eq('event_id', eventId);
      if (delErr) {
        console.error('[syncEventTicketTypes] delete unsold tiers failed:', delErr);
        return { ok: false, retainedWithSales: [], error: 'Failed to remove ticket types' };
      }
    }
  }

  return { ok: true, retainedWithSales };
}
