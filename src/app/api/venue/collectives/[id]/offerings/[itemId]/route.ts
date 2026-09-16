import { NextRequest, NextResponse } from 'next/server';
import { resolveLinkAdmin, enforceLinkRateLimit } from '@/lib/linked-accounts/route-helpers';
import { requireReplicasHost, engineErrorResponse } from '@/lib/linked-accounts/replicas/host-route-helpers';
import { applyLinksInline } from '@/lib/linked-accounts/replicas/inline-apply';
import { invalidateCollectiveCatalogMemo } from '@/lib/linked-accounts/collective-venue';

/**
 * DELETE /api/venue/collectives/[id]/offerings/[itemId] — take a service off the collective page
 * (plan Appendix E contract 1; §6.4 `collective_withdraw_service`).
 *
 * The offering is archived and each member's copy is retired: the copy and its calendars stay, so
 * existing bookings are unaffected, and it simply stops taking new ones. The applies run inline, and
 * the answer names the venues where the service has been retired.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  const resolved = await resolveLinkAdmin();
  if (!resolved.ok) return resolved.response;
  const { ctx } = resolved;
  const { id, itemId } = await params;

  const limited = enforceLinkRateLimit(ctx.venueId, 'collective-offerings', 60, 60_000);
  if (limited) return limited;

  const host = await requireReplicasHost(ctx.admin, id, ctx.venueId);
  if (!host.ok) return host.response;

  const { data: item } = await ctx.admin
    .from('collective_service_items')
    .select('id, collective_id, status')
    .eq('id', itemId)
    .maybeSingle();
  if (!item || item.collective_id !== id) {
    return NextResponse.json({ error: 'That service is not on this collective page.' }, { status: 404 });
  }

  // The links before the withdrawal: they are what has to be applied to retire the copies.
  const { data: linkRows } = await ctx.admin
    .from('collective_service_replicas')
    .select('id, venue_id, venues:venue_id (name)')
    .eq('collective_service_item_id', itemId)
    .is('released_at', null);
  const links = (linkRows ?? []).map((row) => {
    const venue = row.venues as { name?: string } | { name?: string }[] | null;
    return {
      link_id: row.id as string,
      venue_id: row.venue_id as string,
      venue_name: (Array.isArray(venue) ? venue[0]?.name : venue?.name) ?? 'Venue',
    };
  });

  const { error } = await ctx.admin.rpc('collective_withdraw_service', {
    p_item_id: itemId,
    p_actor_venue_id: ctx.venueId,
    p_actor_user_id: ctx.userId,
  });
  if (error) {
    return engineErrorResponse(error, { collective: host.collective.name, host: ctx.venue.name }, 'Could not take that service off the page.');
  }

  const collectiveSync = await applyLinksInline(ctx.admin, links.map((l) => l.link_id), {
    actorVenueId: ctx.venueId,
    actorUserId: ctx.userId,
  });
  invalidateCollectiveCatalogMemo(id);

  return NextResponse.json({
    retired: links
      .filter((l) => !collectiveSync.pending.some((p) => p.venue_id === l.venue_id))
      .map((l) => ({ venue_id: l.venue_id, venue_name: l.venue_name })),
    collective_sync: collectiveSync,
  });
}
