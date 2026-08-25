import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * EV-1: keep a series intact when its parent occurrence is deleted.
 *
 * A multi-date event create designates the earliest occurrence as the series
 * parent (its own `parent_event_id` stays null) and points every sibling at it
 * (C8). The catalogue then groups a series by `parent_event_id ?? id`
 * (`event-ticket-engine.ts`).
 *
 * Migration 20270117120000 changed the FK from ON DELETE CASCADE to SET NULL, so
 * deleting the parent no longer destroys the series. But SET NULL alone would
 * leave every sibling with a null parent, and each would then key as its own
 * one-off series: a 20-week course would fragment into 19 separate cards on the
 * booking page.
 *
 * So before deleting a parent, promote the earliest surviving occurrence and
 * re-point the rest at it. The series survives the delete with one fewer date,
 * which is what a venue removing one occurrence actually means.
 *
 * Called before the delete, and its failure BLOCKS the delete: proceeding on a
 * failed re-parent would let the FK's SET NULL scatter the series instead.
 */
export async function reparentEventSeriesBeforeDelete(
  admin: SupabaseClient,
  params: { venueId: string; eventId: string },
): Promise<{ ok: true; promotedEventId: string | null } | { ok: false; error: string }> {
  const { venueId, eventId } = params;

  const { data, error } = await admin
    .from('experience_events')
    .select('id, event_date')
    .eq('venue_id', venueId)
    .eq('parent_event_id', eventId)
    // Earliest surviving occurrence inherits the series, mirroring how the
    // create route picks the parent. `id` breaks ties so the choice is stable
    // across retries of the same delete.
    .order('event_date', { ascending: true })
    .order('id', { ascending: true });

  if (error) {
    console.error('[reparentEventSeriesBeforeDelete] sibling lookup failed:', error, { eventId });
    return { ok: false, error: 'Could not check whether this event is part of a series.' };
  }

  const siblings = (data ?? []) as Array<{ id: string }>;
  // Not a parent, or a parent whose children are already gone: nothing to do.
  if (siblings.length === 0) return { ok: true, promotedEventId: null };

  const [newParent, ...rest] = siblings;

  const { error: promoteErr } = await admin
    .from('experience_events')
    .update({ parent_event_id: null })
    .eq('id', newParent.id)
    .eq('venue_id', venueId);
  if (promoteErr) {
    console.error('[reparentEventSeriesBeforeDelete] promote failed:', promoteErr, {
      eventId,
      newParentId: newParent.id,
    });
    return { ok: false, error: 'Could not update the rest of this series. Nothing was deleted.' };
  }

  if (rest.length > 0) {
    const { error: repointErr } = await admin
      .from('experience_events')
      .update({ parent_event_id: newParent.id })
      .in(
        'id',
        rest.map((r) => r.id),
      )
      .eq('venue_id', venueId);
    if (repointErr) {
      // The promotion landed and the re-point did not. Roll the promotion back
      // so the series is not left with two parents, then refuse the delete: the
      // original parent row is still present, so this is fully recoverable.
      console.error('[reparentEventSeriesBeforeDelete] re-point failed:', repointErr, {
        eventId,
        newParentId: newParent.id,
      });
      const { error: rollbackErr } = await admin
        .from('experience_events')
        .update({ parent_event_id: eventId })
        .eq('id', newParent.id)
        .eq('venue_id', venueId);
      if (rollbackErr) {
        console.error('[reparentEventSeriesBeforeDelete] rollback failed:', rollbackErr, {
          eventId,
          newParentId: newParent.id,
        });
      }
      return { ok: false, error: 'Could not update the rest of this series. Nothing was deleted.' };
    }
  }

  return { ok: true, promotedEventId: newParent.id };
}
