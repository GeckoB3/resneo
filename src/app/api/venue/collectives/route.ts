import { NextRequest, NextResponse } from 'next/server';
import { resolveLinkAdmin } from '@/lib/linked-accounts/route-helpers';
import { createCollectiveSchema } from '@/lib/linked-accounts/validation';
import {
  hasFullMutualLinks,
  loadCollectiveViewsForVenue,
} from '@/lib/linked-accounts/collectives';
import { notifyCollectiveInvitation } from '@/lib/linked-accounts/notifications';

/** GET /api/venue/collectives — collectives this venue hosts or belongs to. */
export async function GET() {
  const resolved = await resolveLinkAdmin();
  if (!resolved.ok) return resolved.response;
  const { ctx } = resolved;
  if (!ctx.eligibility.feature) {
    return NextResponse.json({ collectives: [] });
  }
  try {
    const collectives = await loadCollectiveViewsForVenue(ctx.admin, ctx.venueId);
    return NextResponse.json({ collectives });
  } catch (err) {
    console.error('GET /api/venue/collectives failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** POST /api/venue/collectives — create a collective and invite linked venues. */
export async function POST(request: NextRequest) {
  const resolved = await resolveLinkAdmin();
  if (!resolved.ok) return resolved.response;
  const { ctx } = resolved;
  if (!ctx.eligibility.canCreate) {
    return NextResponse.json(
      { error: ctx.eligibility.reason ?? 'Collectives cannot be created right now.' },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const parsed = createCollectiveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const slug = parsed.data.slug.toLowerCase();
    const inviteVenueIds = [...new Set(parsed.data.inviteVenueIds)].filter(
      (id) => id !== ctx.venueId,
    );
    if (inviteVenueIds.length === 0) {
      return NextResponse.json(
        { error: 'Invite at least one other linked venue.' },
        { status: 400 },
      );
    }

    // Slug uniqueness among collectives.
    const { data: slugTaken } = await ctx.admin
      .from('venue_collectives')
      .select('id')
      .eq('slug', slug)
      .maybeSingle();
    if (slugTaken) {
      return NextResponse.json(
        { error: 'That booking-page address is already in use. Choose another.' },
        { status: 409 },
      );
    }

    // Name uniqueness among active collectives (case-insensitive).
    const { data: nameTaken } = await ctx.admin
      .from('venue_collectives')
      .select('id')
      .ilike('name', parsed.data.name.trim())
      .eq('status', 'active')
      .maybeSingle();
    if (nameTaken) {
      return NextResponse.json(
        { error: 'A collective with that name already exists. Choose another.' },
        { status: 409 },
      );
    }

    // Every invitee must hold full-mutual links with the host.
    const hostLinksOk = await hasFullMutualLinks(ctx.admin, ctx.venueId, inviteVenueIds);
    if (!hostLinksOk) {
      return NextResponse.json(
        {
          error:
            'You can only invite venues you hold an accepted link with that shares full calendar detail in both directions.',
        },
        { status: 400 },
      );
    }
    // And invitees must hold full-mutual links with each other.
    for (const venueId of inviteVenueIds) {
      const others = inviteVenueIds.filter((v) => v !== venueId);
      const ok = await hasFullMutualLinks(ctx.admin, venueId, others);
      if (!ok) {
        return NextResponse.json(
          {
            error:
              'Every venue in a collective must hold full mutual links with every other member.',
          },
          { status: 400 },
        );
      }
    }

    const { data: collective, error: insertErr } = await ctx.admin
      .from('venue_collectives')
      .insert({
        slug,
        name: parsed.data.name.trim(),
        host_venue_id: ctx.venueId,
        branding: parsed.data.branding ?? {},
        service_grouping: parsed.data.serviceGrouping ?? 'by_practitioner',
        allow_any_practitioner: parsed.data.allowAnyPractitioner ?? false,
        status: 'active',
      })
      .select('id')
      .single();
    if (insertErr || !collective) {
      console.error('POST /api/venue/collectives insert failed:', insertErr?.message);
      return NextResponse.json({ error: 'Failed to create collective.' }, { status: 500 });
    }

    const collectiveId = collective.id as string;
    const memberRows = [
      {
        collective_id: collectiveId,
        venue_id: ctx.venueId,
        status: 'active',
        display_order: 0,
        joined_at: new Date().toISOString(),
        invited_by_user_id: ctx.userId,
      },
      ...inviteVenueIds.map((venueId, i) => ({
        collective_id: collectiveId,
        venue_id: venueId,
        status: 'invited',
        display_order: i + 1,
        invited_by_user_id: ctx.userId,
      })),
    ];
    const { error: membersErr } = await ctx.admin
      .from('venue_collective_members')
      .insert(memberRows);
    if (membersErr) {
      console.error('POST /api/venue/collectives members failed:', membersErr.message);
      await ctx.admin.from('venue_collectives').delete().eq('id', collectiveId);
      return NextResponse.json({ error: 'Failed to invite venues.' }, { status: 500 });
    }

    await Promise.allSettled(
      inviteVenueIds.map((venueId) =>
        notifyCollectiveInvitation(ctx.admin, venueId, parsed.data.name.trim(), ctx.venue.name),
      ),
    );

    const collectives = await loadCollectiveViewsForVenue(ctx.admin, ctx.venueId);
    return NextResponse.json(
      { collective: collectives.find((c) => c.id === collectiveId) ?? null },
      { status: 201 },
    );
  } catch (err) {
    console.error('POST /api/venue/collectives failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
