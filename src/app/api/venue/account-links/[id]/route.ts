import { NextRequest, NextResponse } from 'next/server';
import { resolveLinkAdmin } from '@/lib/linked-accounts/route-helpers';
import { respondLinkSchema } from '@/lib/linked-accounts/validation';
import { loadLinkViewsForVenue } from '@/lib/linked-accounts/queries';
import {
  describeGrant,
  grantsToColumns,
  isLinkConfigurationValid,
  normaliseGrant,
} from '@/lib/linked-accounts/permissions';
import type { AccountLinkRow, LinkGrant, PendingChange } from '@/lib/linked-accounts/types';
import {
  notifyLinkAccepted,
  notifyLinkRejected,
  notifyLinkUnlinked,
  notifyPermissionChangeProposed,
} from '@/lib/linked-accounts/notifications';
import { reconcileCollectivesAfterLinkChange } from '@/lib/linked-accounts/collectives';

interface LinkContextResult {
  link: AccountLinkRow;
  otherVenueId: string;
  iAmRequester: boolean;
  iAmLow: boolean;
}

/** Load a link by id and verify the current venue is a member. */
async function loadMemberLink(
  admin: import('@supabase/supabase-js').SupabaseClient,
  linkId: string,
  myVenueId: string,
): Promise<LinkContextResult | null> {
  const { data } = await admin
    .from('account_links')
    .select(
      'id, venue_low_id, venue_high_id, requested_by_venue_id, status, ' +
        'low_grants_calendar, low_grants_pii, low_grants_act, ' +
        'high_grants_calendar, high_grants_pii, high_grants_act, ' +
        'request_message, pending_change, created_by_user_id, responded_by_user_id, ' +
        'created_at, responded_at, terminated_at, termination_reason, updated_at',
    )
    .eq('id', linkId)
    .maybeSingle();
  if (!data) return null;
  const link = data as unknown as AccountLinkRow;
  const iAmLow = link.venue_low_id === myVenueId;
  const iAmHigh = link.venue_high_id === myVenueId;
  if (!iAmLow && !iAmHigh) return null;
  return {
    link,
    otherVenueId: iAmLow ? link.venue_high_id : link.venue_low_id,
    iAmRequester: link.requested_by_venue_id === myVenueId,
    iAmLow,
  };
}

/** Map a caller-perspective grant pair onto the link's low/high columns. */
function callerGrantsToColumns(
  link: Pick<AccountLinkRow, 'venue_low_id' | 'venue_high_id'>,
  callerVenueId: string,
  pair: { mine: LinkGrant; theirs: LinkGrant },
) {
  const iAmLow = link.venue_low_id === callerVenueId;
  return grantsToColumns({
    venueLowId: link.venue_low_id,
    venueHighId: link.venue_high_id,
    lowGrants: iAmLow ? pair.mine : pair.theirs,
    highGrants: iAmLow ? pair.theirs : pair.mine,
  });
}

async function singleLinkView(
  admin: import('@supabase/supabase-js').SupabaseClient,
  venueId: string,
  linkId: string,
) {
  const views = await loadLinkViewsForVenue(admin, venueId);
  return views.find((v) => v.id === linkId) ?? null;
}

/** PATCH /api/venue/account-links/[id] — respond to or modify a link. */
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
  const parsed = respondLinkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const member = await loadMemberLink(ctx.admin, id, ctx.venueId);
    if (!member) {
      return NextResponse.json({ error: 'Link not found.' }, { status: 404 });
    }
    const { link, otherVenueId, iAmRequester } = member;
    const action = parsed.data.action;

    // ---- Respond to a pending request ----------------------------------
    if (action === 'accept' || action === 'accept_with_changes' || action === 'reject') {
      if (link.status !== 'pending') {
        return NextResponse.json(
          { error: 'This request is no longer pending.' },
          { status: 409 },
        );
      }
      if (iAmRequester) {
        return NextResponse.json(
          { error: 'You cannot respond to a request your own venue sent.' },
          { status: 403 },
        );
      }

      if (action === 'reject') {
        await ctx.admin
          .from('account_links')
          .update({
            status: 'rejected',
            responded_at: new Date().toISOString(),
            responded_by_user_id: ctx.userId,
          })
          .eq('id', id);
        await notifyLinkRejected(ctx.admin, otherVenueId, ctx.venue.name);
        return NextResponse.json({ link: await singleLinkView(ctx.admin, ctx.venueId, id) });
      }

      let updateColumns: Record<string, unknown> = {};
      let withChanges = false;
      if (action === 'accept_with_changes') {
        if (!parsed.data.grants) {
          return NextResponse.json(
            { error: 'Modified permissions are required.' },
            { status: 400 },
          );
        }
        const mine = normaliseGrant(parsed.data.grants.mine);
        const theirs = normaliseGrant(parsed.data.grants.theirs);
        if (!isLinkConfigurationValid(mine, theirs)) {
          return NextResponse.json(
            { error: 'A link must grant access in at least one direction.' },
            { status: 400 },
          );
        }
        updateColumns = callerGrantsToColumns(link, ctx.venueId, { mine, theirs });
        withChanges = true;
      }

      await ctx.admin
        .from('account_links')
        .update({
          ...updateColumns,
          status: 'accepted',
          responded_at: new Date().toISOString(),
          responded_by_user_id: ctx.userId,
        })
        .eq('id', id);

      // Bullets describing what the requester venue can now do to my data.
      const finalRows = await loadMemberLink(ctx.admin, id, ctx.venueId);
      const requesterGrant: LinkGrant = finalRows
        ? finalRows.iAmLow
          ? {
              calendar: finalRows.link.low_grants_calendar,
              pii: finalRows.link.low_grants_pii,
              act: finalRows.link.low_grants_act,
            }
          : {
              calendar: finalRows.link.high_grants_calendar,
              pii: finalRows.link.high_grants_pii,
              act: finalRows.link.high_grants_act,
            }
        : { calendar: 'none', pii: false, act: 'none' };
      await notifyLinkAccepted(
        ctx.admin,
        otherVenueId,
        ctx.venue.name,
        withChanges,
        describeGrant(requesterGrant).map((s) => `Your venue can ${s}`),
      );
      return NextResponse.json({ link: await singleLinkView(ctx.admin, ctx.venueId, id) });
    }

    // ---- Cancel a pending request I sent --------------------------------
    if (action === 'cancel') {
      if (link.status !== 'pending') {
        return NextResponse.json(
          { error: 'Only a pending request can be cancelled.' },
          { status: 409 },
        );
      }
      if (!iAmRequester) {
        return NextResponse.json(
          { error: 'Only the venue that sent the request can cancel it.' },
          { status: 403 },
        );
      }
      await ctx.admin
        .from('account_links')
        .update({ status: 'revoked', terminated_at: new Date().toISOString() })
        .eq('id', id);
      return NextResponse.json({ link: await singleLinkView(ctx.admin, ctx.venueId, id) });
    }

    // ---- Negotiated mid-link permission change --------------------------
    if (action === 'propose_change') {
      if (link.status !== 'accepted') {
        return NextResponse.json(
          { error: 'Permission changes can only be proposed on an active link.' },
          { status: 409 },
        );
      }
      if (link.pending_change) {
        return NextResponse.json(
          { error: 'There is already a pending permission change on this link.' },
          { status: 409 },
        );
      }
      if (!parsed.data.grants) {
        return NextResponse.json({ error: 'Proposed permissions are required.' }, { status: 400 });
      }
      const mine = normaliseGrant(parsed.data.grants.mine);
      const theirs = normaliseGrant(parsed.data.grants.theirs);
      if (!isLinkConfigurationValid(mine, theirs)) {
        return NextResponse.json(
          { error: 'A link must grant access in at least one direction.' },
          { status: 400 },
        );
      }
      const cols = callerGrantsToColumns(link, ctx.venueId, { mine, theirs });
      const unchanged =
        cols.low_grants_calendar === link.low_grants_calendar &&
        cols.low_grants_pii === link.low_grants_pii &&
        cols.low_grants_act === link.low_grants_act &&
        cols.high_grants_calendar === link.high_grants_calendar &&
        cols.high_grants_pii === link.high_grants_pii &&
        cols.high_grants_act === link.high_grants_act;
      if (unchanged) {
        return NextResponse.json(
          { error: 'The proposed permissions match the current permissions.' },
          { status: 400 },
        );
      }
      const pendingChange: PendingChange = {
        by_venue_id: ctx.venueId,
        proposed_at: new Date().toISOString(),
        ...cols,
      };
      await ctx.admin
        .from('account_links')
        .update({ pending_change: pendingChange })
        .eq('id', id);
      await notifyPermissionChangeProposed(
        ctx.admin,
        otherVenueId,
        ctx.venue.name,
        describeGrant(theirs).map((s) => `Your venue would ${s}`),
      );
      return NextResponse.json({ link: await singleLinkView(ctx.admin, ctx.venueId, id) });
    }

    if (action === 'accept_change' || action === 'reject_change' || action === 'cancel_change') {
      const pc = link.pending_change;
      if (!pc) {
        return NextResponse.json(
          { error: 'There is no pending permission change on this link.' },
          { status: 409 },
        );
      }
      const iProposed = pc.by_venue_id === ctx.venueId;
      if (action === 'cancel_change') {
        if (!iProposed) {
          return NextResponse.json(
            { error: 'Only the venue that proposed the change can withdraw it.' },
            { status: 403 },
          );
        }
        await ctx.admin.from('account_links').update({ pending_change: null }).eq('id', id);
        return NextResponse.json({ link: await singleLinkView(ctx.admin, ctx.venueId, id) });
      }
      if (iProposed) {
        return NextResponse.json(
          { error: 'You cannot respond to a change your own venue proposed.' },
          { status: 403 },
        );
      }
      if (action === 'reject_change') {
        await ctx.admin.from('account_links').update({ pending_change: null }).eq('id', id);
        return NextResponse.json({ link: await singleLinkView(ctx.admin, ctx.venueId, id) });
      }
      // accept_change — apply proposed columns.
      await ctx.admin
        .from('account_links')
        .update({
          low_grants_calendar: pc.low_grants_calendar,
          low_grants_pii: pc.low_grants_pii,
          low_grants_act: pc.low_grants_act,
          high_grants_calendar: pc.high_grants_calendar,
          high_grants_pii: pc.high_grants_pii,
          high_grants_act: pc.high_grants_act,
          pending_change: null,
        })
        .eq('id', id);
      // A change may drop visibility below full_details, invalidating any
      // collective that depends on this link (§7.5).
      await reconcileCollectivesAfterLinkChange(ctx.admin, [
        link.venue_low_id,
        link.venue_high_id,
      ]);
      return NextResponse.json({ link: await singleLinkView(ctx.admin, ctx.venueId, id) });
    }

    return NextResponse.json({ error: 'Unsupported action.' }, { status: 400 });
  } catch (err) {
    console.error('PATCH /api/venue/account-links/[id] failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** DELETE /api/venue/account-links/[id] — unlink an active or suspended link. */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const resolved = await resolveLinkAdmin();
  if (!resolved.ok) return resolved.response;
  const { ctx } = resolved;
  const { id } = await params;

  try {
    const member = await loadMemberLink(ctx.admin, id, ctx.venueId);
    if (!member) {
      return NextResponse.json({ error: 'Link not found.' }, { status: 404 });
    }
    if (member.link.status !== 'accepted' && member.link.status !== 'suspended') {
      return NextResponse.json(
        { error: 'Only an active or suspended link can be unlinked.' },
        { status: 409 },
      );
    }

    await ctx.admin
      .from('account_links')
      .update({
        status: 'revoked',
        terminated_at: new Date().toISOString(),
        termination_reason: 'unlinked',
        pending_change: null,
      })
      .eq('id', id);

    await notifyLinkUnlinked(ctx.admin, member.otherVenueId, ctx.venue.name);

    // Unlinking breaks any collective that relied on this pairwise link (§7.5).
    await reconcileCollectivesAfterLinkChange(ctx.admin, [
      member.link.venue_low_id,
      member.link.venue_high_id,
    ]);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/venue/account-links/[id] failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
