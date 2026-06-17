import { NextRequest, NextResponse } from 'next/server';
import { resolveLinkAdmin } from '@/lib/linked-accounts/route-helpers';
import { createCollectiveSchema } from '@/lib/linked-accounts/validation';
import { loadCollectiveViewsForVenue } from '@/lib/linked-accounts/collectives';
import { checkCombinedEligibility } from '@/lib/linked-accounts/catalogue';
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
    // One collective per venue: refuse a second when this venue already hosts or
    // belongs to a live (non-dissolved) collective. The UI hides the create button
    // in this case; this guards a stale client or a direct API call. Further members
    // are added from the combined page's Members tab; end it via Dissolve.
    const existingViews = await loadCollectiveViewsForVenue(ctx.admin, ctx.venueId);
    if (existingViews.some((c) => c.status !== 'dissolved')) {
      return NextResponse.json(
        {
          error:
            'Your venue is already in a collective. Add members from the combined page’s Members tab, or dissolve it first.',
        },
        { status: 409 },
      );
    }

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
    const trimmedName = parsed.data.name.trim();
    const { data: nameTaken } = await ctx.admin
      .from('venue_collectives')
      .select('id')
      .ilike('name', trimmedName)
      .eq('status', 'active')
      .maybeSingle();
    if (nameTaken) {
      return NextResponse.json(
        { error: 'A collective with that name already exists. Choose another.' },
        { status: 409 },
      );
    }

    // §7.2.1 — a dissolved collective's name is held for 30 days before reuse.
    // `updated_at` is bumped when a collective is dissolved, so it stands in for
    // the dissolution time. The message doesn't disclose which collective held it.
    //
    // Exception: a venue may immediately reuse the name of a collective IT hosted.
    // The hold exists to stop one venue grabbing the name another just released
    // (and to keep the rejection non-disclosing) — neither concern applies to your
    // own collective, so `.neq('host_venue_id', …)` lets a host recreate the one it
    // just dissolved without waiting out the cooldown.
    const cooldownCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: recentlyDissolved } = await ctx.admin
      .from('venue_collectives')
      .select('id')
      .ilike('name', trimmedName)
      .eq('status', 'dissolved')
      .gte('updated_at', cooldownCutoff)
      .neq('host_venue_id', ctx.venueId)
      .maybeSingle();
    if (recentlyDissolved) {
      return NextResponse.json(
        { error: 'That name isn’t available yet. Please choose another.' },
        { status: 409 },
      );
    }

    // Combined-only (plan §22 / D-V1): a collective is born as a combined page,
    // so the D4 write gate + D8 single-timezone check is enforced at create time
    // across every member (host + invitees).
    const eligibility = await checkCombinedEligibility(ctx.admin, [ctx.venueId, ...inviteVenueIds]);
    if (!eligibility.ok) {
      return NextResponse.json(
        { error: eligibility.reason ?? 'These venues can’t run a combined page yet.' },
        { status: 400 },
      );
    }

    const { data: collective, error: insertErr } = await ctx.admin
      .from('venue_collectives')
      .insert({
        slug,
        name: parsed.data.name.trim(),
        host_venue_id: ctx.venueId,
        branding: parsed.data.branding ?? {},
        service_grouping: parsed.data.serviceGrouping ?? 'by_practitioner',
        allow_any_practitioner: false,
        status: 'active',
        page_mode: 'unified_catalog',
        timezone: eligibility.timezone,
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
