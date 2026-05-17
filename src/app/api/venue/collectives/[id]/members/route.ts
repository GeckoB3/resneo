import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveLinkAdmin } from '@/lib/linked-accounts/route-helpers';
import { collectiveMemberActionSchema } from '@/lib/linked-accounts/validation';
import {
  hasFullMutualLinks,
  loadCollectiveViewsForVenue,
  reconcileCollective,
} from '@/lib/linked-accounts/collectives';
import {
  notifyCollectiveDissolved,
  notifyCollectiveInvitation,
  notifyCollectiveRemoval,
} from '@/lib/linked-accounts/notifications';

interface CollectiveRow {
  id: string;
  host_venue_id: string;
  status: string;
  name: string;
}

async function activeMemberVenueIds(
  admin: SupabaseClient,
  collectiveId: string,
): Promise<string[]> {
  const { data } = await admin
    .from('venue_collective_members')
    .select('venue_id')
    .eq('collective_id', collectiveId)
    .eq('status', 'active');
  return (data ?? []).map((m) => m.venue_id as string);
}

/** PATCH /api/venue/collectives/[id]/members — membership actions. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const resolved = await resolveLinkAdmin();
  if (!resolved.ok) return resolved.response;
  const { ctx } = resolved;
  const { id: collectiveId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const parsed = collectiveMemberActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const input = parsed.data;

  try {
    const { data: collectiveData } = await ctx.admin
      .from('venue_collectives')
      .select('id, host_venue_id, status, name')
      .eq('id', collectiveId)
      .maybeSingle();
    if (!collectiveData) {
      return NextResponse.json({ error: 'Collective not found.' }, { status: 404 });
    }
    const collective = collectiveData as CollectiveRow;
    if (collective.status !== 'active') {
      return NextResponse.json({ error: 'This collective has been dissolved.' }, { status: 409 });
    }
    const isHost = collective.host_venue_id === ctx.venueId;

    // The current venue's membership row, if any.
    const { data: myMembership } = await ctx.admin
      .from('venue_collective_members')
      .select('id, status')
      .eq('collective_id', collectiveId)
      .eq('venue_id', ctx.venueId)
      .in('status', ['invited', 'active'])
      .maybeSingle();

    const finish = async () => {
      const collectives = await loadCollectiveViewsForVenue(ctx.admin, ctx.venueId);
      return NextResponse.json({
        collective: collectives.find((c) => c.id === collectiveId) ?? null,
      });
    };

    // ---- invite ---------------------------------------------------------
    if (input.action === 'invite') {
      if (!isHost) {
        return NextResponse.json(
          { error: 'Only the host venue can invite members.' },
          { status: 403 },
        );
      }
      if (!input.venueId) {
        return NextResponse.json({ error: 'A venue to invite is required.' }, { status: 400 });
      }
      const existing = await ctx.admin
        .from('venue_collective_members')
        .select('id')
        .eq('collective_id', collectiveId)
        .eq('venue_id', input.venueId)
        .in('status', ['invited', 'active'])
        .maybeSingle();
      if (existing.data) {
        return NextResponse.json(
          { error: 'That venue is already invited or a member.' },
          { status: 409 },
        );
      }
      const members = await activeMemberVenueIds(ctx.admin, collectiveId);
      const ok = await hasFullMutualLinks(ctx.admin, input.venueId, members);
      if (!ok) {
        return NextResponse.json(
          {
            error:
              'That venue must hold full mutual links with every current member before it can be invited.',
          },
          { status: 400 },
        );
      }
      await ctx.admin.from('venue_collective_members').insert({
        collective_id: collectiveId,
        venue_id: input.venueId,
        status: 'invited',
        display_order: members.length,
        invited_by_user_id: ctx.userId,
      });
      await notifyCollectiveInvitation(
        ctx.admin,
        input.venueId,
        collective.name,
        ctx.venue.name,
      );
      return finish();
    }

    // ---- transfer_host --------------------------------------------------
    if (input.action === 'transfer_host') {
      if (!isHost) {
        return NextResponse.json(
          { error: 'Only the current host can transfer host status.' },
          { status: 403 },
        );
      }
      if (!input.venueId) {
        return NextResponse.json({ error: 'A new host venue is required.' }, { status: 400 });
      }
      const members = await activeMemberVenueIds(ctx.admin, collectiveId);
      if (!members.includes(input.venueId)) {
        return NextResponse.json(
          { error: 'The new host must be an active member of the collective.' },
          { status: 400 },
        );
      }
      await ctx.admin
        .from('venue_collectives')
        .update({ host_venue_id: input.venueId })
        .eq('id', collectiveId);
      return finish();
    }

    // ---- remove (host removes a member) --------------------------------
    if (input.action === 'remove') {
      if (!isHost) {
        return NextResponse.json(
          { error: 'Only the host venue can remove members.' },
          { status: 403 },
        );
      }
      if (!input.venueId || input.venueId === ctx.venueId) {
        return NextResponse.json({ error: 'Choose a member to remove.' }, { status: 400 });
      }
      await ctx.admin
        .from('venue_collective_members')
        .update({ status: 'removed', left_at: new Date().toISOString() })
        .eq('collective_id', collectiveId)
        .eq('venue_id', input.venueId)
        .in('status', ['invited', 'active']);
      await notifyCollectiveRemoval(ctx.admin, input.venueId, collective.name);
      const { dissolved } = await reconcileCollective(ctx.admin, collectiveId);
      if (dissolved) {
        const others = await ctx.admin
          .from('venue_collective_members')
          .select('venue_id')
          .eq('collective_id', collectiveId);
        await Promise.allSettled(
          (others.data ?? [])
            .map((m) => m.venue_id as string)
            .filter((v) => v !== ctx.venueId)
            .map((v) => notifyCollectiveDissolved(ctx.admin, v, collective.name)),
        );
      }
      return finish();
    }

    // ---- accept / decline / leave / configure (own membership) ---------
    if (!myMembership) {
      return NextResponse.json(
        { error: 'Your venue is not a member of this collective.' },
        { status: 404 },
      );
    }

    if (input.action === 'accept') {
      if (myMembership.status !== 'invited') {
        return NextResponse.json(
          { error: 'This invitation is no longer open.' },
          { status: 409 },
        );
      }
      const members = await activeMemberVenueIds(ctx.admin, collectiveId);
      const ok = await hasFullMutualLinks(ctx.admin, ctx.venueId, members);
      if (!ok) {
        return NextResponse.json(
          {
            error:
              'You must hold full mutual links with every member before joining this collective.',
          },
          { status: 400 },
        );
      }
      await ctx.admin
        .from('venue_collective_members')
        .update({
          status: 'active',
          joined_at: new Date().toISOString(),
          visible_practitioner_ids: input.visiblePractitionerIds ?? [],
          visible_service_ids: input.visibleServiceIds ?? [],
          allow_any_practitioner_substitution: input.allowAnyPractitionerSubstitution ?? false,
          display_order: input.displayOrder ?? 0,
        })
        .eq('id', myMembership.id);
      return finish();
    }

    if (input.action === 'decline') {
      await ctx.admin
        .from('venue_collective_members')
        .update({ status: 'removed', left_at: new Date().toISOString() })
        .eq('id', myMembership.id);
      return finish();
    }

    if (input.action === 'leave') {
      if (isHost) {
        return NextResponse.json(
          {
            error:
              'The host venue cannot leave. Transfer host status to another member or dissolve the collective.',
          },
          { status: 400 },
        );
      }
      await ctx.admin
        .from('venue_collective_members')
        .update({ status: 'left', left_at: new Date().toISOString() })
        .eq('id', myMembership.id);
      const { dissolved } = await reconcileCollective(ctx.admin, collectiveId);
      if (dissolved) {
        const others = await ctx.admin
          .from('venue_collective_members')
          .select('venue_id')
          .eq('collective_id', collectiveId);
        await Promise.allSettled(
          (others.data ?? [])
            .map((m) => m.venue_id as string)
            .filter((v) => v !== ctx.venueId)
            .map((v) => notifyCollectiveDissolved(ctx.admin, v, collective.name)),
        );
      }
      return finish();
    }

    if (input.action === 'configure') {
      const updates: Record<string, unknown> = {};
      if (input.visiblePractitionerIds !== undefined) {
        updates.visible_practitioner_ids = input.visiblePractitionerIds;
      }
      if (input.visibleServiceIds !== undefined) {
        updates.visible_service_ids = input.visibleServiceIds;
      }
      if (input.allowAnyPractitionerSubstitution !== undefined) {
        updates.allow_any_practitioner_substitution = input.allowAnyPractitionerSubstitution;
      }
      if (input.displayOrder !== undefined) updates.display_order = input.displayOrder;
      if (Object.keys(updates).length === 0) {
        return NextResponse.json({ error: 'No changes supplied.' }, { status: 400 });
      }
      await ctx.admin
        .from('venue_collective_members')
        .update(updates)
        .eq('id', myMembership.id);
      return finish();
    }

    return NextResponse.json({ error: 'Unsupported action.' }, { status: 400 });
  } catch (err) {
    console.error('PATCH /api/venue/collectives/[id]/members failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
