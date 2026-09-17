import { NextResponse } from 'next/server';
import { resolveLinkAdmin } from '@/lib/linked-accounts/route-helpers';

/**
 * GET /api/venue/collectives/[id]/leave: what the Leave dialog says before a member leaves a
 * shared-services collective (UX spec J7, `leave.*`): how many services become the venue's own, how
 * many of those take a payment it cannot take without Stripe, the venues whose account links stay as
 * they are, and whether leaving ends the collective.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const resolved = await resolveLinkAdmin();
  if (!resolved.ok) return resolved.response;
  const { ctx } = resolved;
  const { id } = await params;

  const [{ data: collective }, { data: members }] = await Promise.all([
    ctx.admin.from('venue_collectives').select('name, host_venue_id, service_model, status').eq('id', id).maybeSingle(),
    ctx.admin
      .from('venue_collective_members')
      .select('id, venue_id, status')
      .eq('collective_id', id)
      .in('status', ['active', 'invited']),
  ]);
  const mine = (members ?? []).find((m) => m.venue_id === ctx.venueId && m.status === 'active');
  if (!collective || collective.status !== 'active' || !mine) {
    return NextResponse.json({ error: 'Your venue is not part of this collective.' }, { status: 404 });
  }
  if (collective.service_model !== 'replicas') {
    return NextResponse.json({ error: 'This collective does not use shared services yet.' }, { status: 409 });
  }

  const others = (members ?? []).filter((m) => m.status === 'active' && m.venue_id !== ctx.venueId);
  const invited = (members ?? []).filter((m) => m.status === 'invited').length;
  const venueIds = [...new Set([collective.host_venue_id as string, ...others.map((m) => m.venue_id as string)])];
  const [{ data: venues }, { data: me }, { data: links }] = await Promise.all([
    ctx.admin.from('venues').select('id, name').in('id', venueIds),
    ctx.admin.from('venues').select('stripe_charges_enabled').eq('id', ctx.venueId).maybeSingle(),
    ctx.admin
      .from('collective_service_replicas')
      .select('replica_service_id')
      .eq('member_id', mine.id as string)
      .is('released_at', null)
      .not('replica_service_id', 'is', null),
  ]);
  const serviceIds = (links ?? []).map((l) => l.replica_service_id as string);
  let paid = 0;
  if (serviceIds.length > 0 && me?.stripe_charges_enabled !== true) {
    const { data: services } = await ctx.admin
      .from('service_items')
      .select('id, payment_requirement')
      .in('id', serviceIds);
    paid = (services ?? []).filter((s) => ((s.payment_requirement as string | null) ?? 'none') !== 'none').length;
  }
  const nameOf = (venueId: string) => ((venues ?? []).find((v) => v.id === venueId)?.name as string | undefined) ?? 'A venue';
  // The same rule as the engine's ending (below-two.ts): fewer than two, and no invitation to wait for.
  const remaining = others.length;
  const lastMember = remaining < 2 && !(remaining >= 1 && remaining + invited >= 2);

  return NextResponse.json(
    {
      collective_name: collective.name as string,
      host_name: nameOf(collective.host_venue_id as string),
      services: serviceIds.length,
      no_stripe: paid,
      other_venues: others.map((m) => nameOf(m.venue_id as string)).sort((a, b) => a.localeCompare(b)),
      last_member: lastMember,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
