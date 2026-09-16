import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveLinkAdmin, enforceLinkRateLimit } from '@/lib/linked-accounts/route-helpers';
import { requireReplicasHost, engineErrorResponse } from '@/lib/linked-accounts/replicas/host-route-helpers';
import { applyLinksInline } from '@/lib/linked-accounts/replicas/inline-apply';
import { invalidateCollectiveCatalogMemo } from '@/lib/linked-accounts/collective-venue';

const offerSchema = z.object({ service_id: z.string().uuid() });

/**
 * POST /api/venue/collectives/[id]/offerings — put one of the host's own services on the collective
 * page (plan Appendix E contract 1; §6.4 `collective_offer_service`).
 *
 * The engine creates the offering and one replica link per active member, forces the two staff
 * naming flags off on the master (D29), and audits it. The applies then run inline within a short
 * budget, so the host is told which venues are already up to date and which are still updating; the
 * cron picks up the rest.
 *
 * "Add from another venue" (T28), which copies a member's service into a new host master first, is
 * a separate body shape and comes with the adoption flow.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolved = await resolveLinkAdmin();
  if (!resolved.ok) return resolved.response;
  const { ctx } = resolved;
  const { id } = await params;

  const limited = enforceLinkRateLimit(ctx.venueId, 'collective-offerings', 60, 60_000);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const parsed = offerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'A service to offer is required.' }, { status: 400 });
  }

  const host = await requireReplicasHost(ctx.admin, id, ctx.venueId);
  if (!host.ok) return host.response;

  const { data: service } = await ctx.admin
    .from('service_items')
    .select('id, name, venue_id, is_active')
    .eq('id', parsed.data.service_id)
    .maybeSingle();
  if (!service || service.venue_id !== ctx.venueId) {
    return NextResponse.json(
      { error: 'Only one of your own services can go on the collective page.', code: 'COLLECTIVE_OFFERING_NEEDS_HOST_SERVICE' },
      { status: 409 },
    );
  }

  const { data, error } = await ctx.admin.rpc('collective_offer_service', {
    p_collective_id: id,
    p_master_service_id: parsed.data.service_id,
    p_actor_venue_id: ctx.venueId,
    p_actor_user_id: ctx.userId,
  });
  if (error) {
    return engineErrorResponse(error, { collective: host.collective.name, host: ctx.venue.name }, 'Could not put that service on the page.');
  }

  const result = (data ?? {}) as {
    item_id?: string;
    reoffered?: boolean;
    links?: { link_id: string; venue_id: string; venue_name: string }[];
  };
  const links = result.links ?? [];
  const collectiveSync = await applyLinksInline(ctx.admin, links.map((l) => l.link_id), {
    actorVenueId: ctx.venueId,
    actorUserId: ctx.userId,
  });
  invalidateCollectiveCatalogMemo(id);

  return NextResponse.json(
    {
      item_id: result.item_id ?? null,
      reoffered: result.reoffered ?? false,
      links: links.map((l) => ({
        venue_id: l.venue_id,
        venue_name: l.venue_name,
        status: collectiveSync.pending.some((p) => p.venue_id === l.venue_id)
          ? 'behind'
          : collectiveSync.failed.some((f) => f.venue_id === l.venue_id)
            ? 'failing'
            : 'current',
      })),
      collective_sync: collectiveSync,
    },
    { status: 201 },
  );
}
