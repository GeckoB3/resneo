import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveLinkAdmin, enforceLinkRateLimit } from '@/lib/linked-accounts/route-helpers';
import { requireReplicasHost, engineErrorResponse } from '@/lib/linked-accounts/replicas/host-route-helpers';
import { invalidateCollectiveCatalogMemo } from '@/lib/linked-accounts/collective-venue';

/** The seven per-calendar values (W8). An absent key is unchanged; null clears one. */
const valuesSchema = z
  .object({
    custom_name: z.string().trim().min(1).max(200).nullable(),
    custom_description: z.string().max(2000).nullable(),
    custom_duration_minutes: z.number().int().min(5).max(480).nullable(),
    custom_buffer_minutes: z.number().int().min(0).max(120).nullable(),
    custom_price_pence: z.number().int().min(0).nullable(),
    custom_deposit_pence: z.number().int().min(0).nullable(),
    custom_colour: z.string().max(20).nullable(),
  })
  .partial();

const bodySchema = z.object({
  calendar_id: z.string().uuid(),
  service_id: z.string().uuid(),
  values: valuesSchema,
});

/**
 * PUT /api/venue/collectives/[id]/calendar-values — the host sets a calendar's own price, length,
 * name and so on for a service on the collective page, including a member's calendar (plan Appendix
 * E contract 12; `collective_set_calendar_values`).
 *
 * The engine allows a value only while the service's matching "staff may customise" setting is on,
 * so a name or description is never set on a service the collective manages (D29), and clearing is
 * always allowed (D6). A member's own staff keep their own route for their own calendars.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolved = await resolveLinkAdmin();
  if (!resolved.ok) return resolved.response;
  const { ctx } = resolved;
  const { id } = await params;

  const limited = enforceLinkRateLimit(ctx.venueId, 'collective-calendar-values', 120, 60_000);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'A calendar, a service and the values to set are required.', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  if (Object.keys(parsed.data.values).length === 0) {
    return NextResponse.json({ error: 'There is nothing to change.' }, { status: 400 });
  }

  const host = await requireReplicasHost(ctx.admin, id, ctx.venueId);
  if (!host.ok) return host.response;

  const { data, error } = await ctx.admin.rpc('collective_set_calendar_values', {
    p_calendar_id: parsed.data.calendar_id,
    p_service_item_id: parsed.data.service_id,
    p_values: parsed.data.values,
    p_actor_venue_id: ctx.venueId,
    p_actor_user_id: ctx.userId,
  });
  if (error) {
    return engineErrorResponse(error, { collective: host.collective.name, host: ctx.venue.name }, 'Could not save those values.');
  }

  invalidateCollectiveCatalogMemo(id);
  const result = (data ?? {}) as { assignment_id?: string; before?: unknown; after?: unknown };
  return NextResponse.json({
    assignment_id: result.assignment_id ?? null,
    before: result.before ?? null,
    after: result.after ?? null,
  });
}
