import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveLinkAdmin, enforceLinkRateLimit } from '@/lib/linked-accounts/route-helpers';
import { requireReplicasHost, engineErrorResponse } from '@/lib/linked-accounts/replicas/host-route-helpers';
import { invalidateCollectiveCatalogMemo } from '@/lib/linked-accounts/collective-venue';

const calendarSchema = z.object({
  item_id: z.string().uuid(),
  venue_id: z.string().uuid(),
  calendar_id: z.string().uuid(),
  action: z.enum(['assign', 'unassign']),
  /** The host has seen the bookings a removal would leave behind and still wants it. */
  acknowledge_affected: z.boolean().optional(),
});

/**
 * POST /api/venue/collectives/[id]/calendars — the host chooses which calendars offer a service,
 * at its own venue and at members (plan §6.7, `collective_set_calendar_offering`).
 *
 * This is the only path that writes another venue's calendar assignments. Removing a calendar that
 * has future bookings for the service answers them first, without any client details, and writes
 * nothing until the host sends `acknowledge_affected`. The member keeps its own tick box for its own
 * calendars (R10), which is a different route.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolved = await resolveLinkAdmin();
  if (!resolved.ok) return resolved.response;
  const { ctx } = resolved;
  const { id } = await params;

  const limited = enforceLinkRateLimit(ctx.venueId, 'collective-calendars', 120, 60_000);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const parsed = calendarSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'A service, venue, calendar and action are required.' }, { status: 400 });
  }

  const host = await requireReplicasHost(ctx.admin, id, ctx.venueId);
  if (!host.ok) return host.response;

  const { data, error } = await ctx.admin.rpc('collective_set_calendar_offering', {
    p_collective_id: id,
    p_item_id: parsed.data.item_id,
    p_venue_id: parsed.data.venue_id,
    p_calendar_id: parsed.data.calendar_id,
    p_action: parsed.data.action,
    p_actor_venue_id: ctx.venueId,
    p_actor_user_id: ctx.userId,
    p_acknowledge_affected: parsed.data.acknowledge_affected ?? false,
  });
  if (error) {
    return engineErrorResponse(
      error,
      { collective: host.collective.name, host: ctx.venue.name },
      parsed.data.action === 'assign'
        ? 'Could not add that calendar.'
        : 'Could not take that calendar off.',
    );
  }

  const result = (data ?? {}) as {
    assignment_id?: string | null;
    affected_bookings?: { booking_date: string; booking_time: string; calendar_id: string }[];
    written?: boolean;
  };
  invalidateCollectiveCatalogMemo(id);

  // A removal the host has not acknowledged: say what is booked, write nothing.
  if (parsed.data.action === 'unassign' && result.written === false && (result.affected_bookings?.length ?? 0) > 0) {
    return NextResponse.json(
      {
        requires_confirmation: true,
        affected_bookings: result.affected_bookings,
        written: false,
      },
      { status: 409 },
    );
  }

  return NextResponse.json({
    assignment_id: result.assignment_id ?? null,
    written: result.written ?? false,
    affected_bookings: result.affected_bookings ?? [],
  });
}
