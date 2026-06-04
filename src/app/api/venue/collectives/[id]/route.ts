import { NextRequest, NextResponse } from 'next/server';
import { resolveLinkAdmin } from '@/lib/linked-accounts/route-helpers';
import { updateCollectiveSchema } from '@/lib/linked-accounts/validation';
import { loadCollectiveViewsForVenue } from '@/lib/linked-accounts/collectives';
import { notifyCollectiveDissolved } from '@/lib/linked-accounts/notifications';

async function loadHostedCollective(
  admin: import('@supabase/supabase-js').SupabaseClient,
  collectiveId: string,
) {
  const { data } = await admin
    .from('venue_collectives')
    .select('id, host_venue_id, status, name')
    .eq('id', collectiveId)
    .maybeSingle();
  return data as { id: string; host_venue_id: string; status: string; name: string } | null;
}

/** PATCH /api/venue/collectives/[id] — host edits collective settings. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const resolved = await resolveLinkAdmin();
  if (!resolved.ok) return resolved.response;
  const { ctx } = resolved;
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const parsed = updateCollectiveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const collective = await loadHostedCollective(ctx.admin, id);
    if (!collective) {
      return NextResponse.json({ error: 'Collective not found.' }, { status: 404 });
    }
    if (collective.host_venue_id !== ctx.venueId) {
      return NextResponse.json(
        { error: 'Only the host venue can change collective settings.' },
        { status: 403 },
      );
    }
    if (collective.status !== 'active') {
      return NextResponse.json(
        { error: 'This collective has been dissolved.' },
        { status: 409 },
      );
    }

    const updates: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) {
      const name = parsed.data.name.trim();
      const { data: nameTaken } = await ctx.admin
        .from('venue_collectives')
        .select('id')
        .ilike('name', name)
        .eq('status', 'active')
        .neq('id', id)
        .maybeSingle();
      if (nameTaken) {
        return NextResponse.json(
          { error: 'A collective with that name already exists.' },
          { status: 409 },
        );
      }
      // §7.2.1 — a renamed collective must also respect the 30-day cooldown on
      // names of recently-dissolved collectives (same rule as create).
      const cooldownCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data: recentlyDissolved } = await ctx.admin
        .from('venue_collectives')
        .select('id')
        .ilike('name', name)
        .eq('status', 'dissolved')
        .gte('updated_at', cooldownCutoff)
        .neq('id', id)
        .maybeSingle();
      if (recentlyDissolved) {
        return NextResponse.json(
          { error: 'That name isn’t available yet. Please choose another.' },
          { status: 409 },
        );
      }
      updates.name = name;
    }
    if (parsed.data.branding !== undefined) updates.branding = parsed.data.branding;
    if (parsed.data.serviceGrouping !== undefined) {
      updates.service_grouping = parsed.data.serviceGrouping;
    }
    if (parsed.data.allowAnyPractitioner !== undefined) {
      updates.allow_any_practitioner = parsed.data.allowAnyPractitioner;
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No changes supplied.' }, { status: 400 });
    }

    const { error } = await ctx.admin
      .from('venue_collectives')
      .update(updates)
      .eq('id', id);
    if (error) {
      console.error('PATCH /api/venue/collectives/[id] failed:', error.message);
      return NextResponse.json({ error: 'Failed to update collective.' }, { status: 500 });
    }

    const collectives = await loadCollectiveViewsForVenue(ctx.admin, ctx.venueId);
    return NextResponse.json({ collective: collectives.find((c) => c.id === id) ?? null });
  } catch (err) {
    console.error('PATCH /api/venue/collectives/[id] failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** DELETE /api/venue/collectives/[id] — host dissolves the collective. */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const resolved = await resolveLinkAdmin();
  if (!resolved.ok) return resolved.response;
  const { ctx } = resolved;
  const { id } = await params;

  try {
    const collective = await loadHostedCollective(ctx.admin, id);
    if (!collective) {
      return NextResponse.json({ error: 'Collective not found.' }, { status: 404 });
    }
    if (collective.host_venue_id !== ctx.venueId) {
      return NextResponse.json(
        { error: 'Only the host venue can dissolve the collective.' },
        { status: 403 },
      );
    }
    if (collective.status !== 'active') {
      return NextResponse.json({ ok: true });
    }

    const { data: members } = await ctx.admin
      .from('venue_collective_members')
      .select('venue_id')
      .eq('collective_id', id)
      .in('status', ['invited', 'active']);

    await ctx.admin
      .from('venue_collectives')
      .update({ status: 'dissolved' })
      .eq('id', id);
    await ctx.admin
      .from('venue_collective_members')
      .update({ status: 'left', left_at: new Date().toISOString() })
      .eq('collective_id', id)
      .in('status', ['invited', 'active']);

    await Promise.allSettled(
      (members ?? [])
        .map((m) => m.venue_id as string)
        .filter((v) => v !== ctx.venueId)
        .map((venueId) => notifyCollectiveDissolved(ctx.admin, venueId, collective.name)),
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/venue/collectives/[id] failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
