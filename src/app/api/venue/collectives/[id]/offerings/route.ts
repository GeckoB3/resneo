import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveLinkAdmin, enforceLinkRateLimit } from '@/lib/linked-accounts/route-helpers';
import { requireReplicasHost, engineErrorResponse } from '@/lib/linked-accounts/replicas/host-route-helpers';
import { applyLinksInline } from '@/lib/linked-accounts/replicas/inline-apply';
import { invalidateCollectiveCatalogMemo } from '@/lib/linked-accounts/collective-venue';
import { notifyServiceOffered } from '@/lib/linked-accounts/replicas/collective-notices';
import { ownServicesAt, runAddFromVenue } from '@/lib/linked-accounts/replicas/adoptions';

const offerSchema = z.object({ service_id: z.string().uuid() });
const addFromSchema = z.object({ source_venue_id: z.string().uuid(), source_service_id: z.string().uuid() });

/**
 * GET /api/venue/collectives/[id]/offerings?source_venue_id=: the member's own services the host
 * can add to the page ("Add from another venue", UX spec `svc.addFrom.*`).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolved = await resolveLinkAdmin();
  if (!resolved.ok) return resolved.response;
  const { ctx } = resolved;
  const { id } = await params;
  const sourceVenueId = request.nextUrl.searchParams.get('source_venue_id') ?? '';
  if (!z.string().uuid().safeParse(sourceVenueId).success) {
    return NextResponse.json({ error: 'Choose a venue.' }, { status: 400 });
  }
  const host = await requireReplicasHost(ctx.admin, id, ctx.venueId);
  if (!host.ok) return host.response;
  const { data: membership } = await ctx.admin
    .from('venue_collective_members')
    .select('id')
    .eq('collective_id', id)
    .eq('venue_id', sourceVenueId)
    .eq('status', 'active')
    .maybeSingle();
  if (!membership || sourceVenueId === ctx.venueId) {
    return NextResponse.json({ error: `That venue is not a member of ${host.collective.name}.` }, { status: 404 });
  }
  const services = await ownServicesAt(ctx.admin, sourceVenueId);
  return NextResponse.json({ services }, { headers: { 'Cache-Control': 'no-store' } });
}

/**
 * POST /api/venue/collectives/[id]/offerings — put one of the host's own services on the collective
 * page (plan Appendix E contract 1; §6.4 `collective_offer_service`).
 *
 * The engine creates the offering and one replica link per active member, forces the two staff
 * naming flags off on the master (D29), and audits it. The applies then run inline within a short
 * budget, so the host is told which venues are already up to date and which are still updating; the
 * cron picks up the rest.
 *
 * "Add from another venue" (T28) is the other body shape, `{ source_venue_id, source_service_id }`:
 * the engine copies the member's service into a new host service first, offers that, and asks the
 * member whether to use its own (adoptions.ts).
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
  const addFrom = addFromSchema.safeParse(body);
  if (addFrom.success) {
    const host = await requireReplicasHost(ctx.admin, id, ctx.venueId);
    if (!host.ok) return host.response;
    const added = await runAddFromVenue(
      {
        admin: ctx.admin,
        collectiveId: id,
        collectiveName: host.collective.name,
        hostVenueId: ctx.venueId,
        hostVenueName: ctx.venue.name,
        venueId: ctx.venueId,
        userId: ctx.userId,
      },
      { venueId: addFrom.data.source_venue_id, serviceId: addFrom.data.source_service_id },
    );
    if (!added.ok) return added.response;
    invalidateCollectiveCatalogMemo(id);
    return NextResponse.json(added.result, { status: 201 });
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
    /** Members asked whether to use their own same-named service first (plan L13). */
    pending?: { venue_id: string; venue_name: string; service_id: string }[];
  };
  const links = result.links ?? [];
  const collectiveSync = await applyLinksInline(ctx.admin, links.map((l) => l.link_id), {
    actorVenueId: ctx.venueId,
    actorUserId: ctx.userId,
  });
  invalidateCollectiveCatalogMemo(id);

  // N8: every member now has a copy to give calendars to. A bell, not an email: the day's other
  // changes reach them in the digest.
  await notifyServiceOffered(ctx.admin, {
    memberVenueIds: links.map((l) => l.venue_id),
    collectiveId: id,
    collectiveName: host.collective.name,
    hostVenueId: ctx.venueId,
    hostVenueName: ctx.venue.name,
    serviceName: (service.name as string) ?? 'A service',
  });

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
      pending: result.pending ?? [],
    },
    { status: 201 },
  );
}
