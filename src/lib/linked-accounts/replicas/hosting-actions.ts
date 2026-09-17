/**
 * Moving the hosting of a collective on the shared-services model (plan §6.7; Appendix E contract
 * 8; UX spec `transfer.*`; W7).
 *
 * Five actions on the members route, each one engine call:
 *   offer_host            the host asks one active member (it answers N20 through the queue);
 *   accept_host           the member it asked accepts, with the consent version it was shown, and
 *                         hosting moves 14 days later (N21 to every venue);
 *   decline_host          the member it asked says no;
 *   cancel_host_transfer  the host withdraws the request, or the accepted move before its day;
 *   take_over_hosting     a member takes over a paused collective straight away, with consent.
 *
 * The older `transfer_host` action wrote the host directly, which the engine's guard refuses on
 * this model, so it answers with the reason rather than a database error.
 */
import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { apiError } from '@/lib/api/error-codes';
import { engineErrorResponse } from '@/lib/linked-accounts/replicas/host-route-helpers';
import { applyLinksInline } from '@/lib/linked-accounts/replicas/inline-apply';
import { recordBell } from '@/lib/linked-accounts/replicas/collective-notices';
import { collectiveCopy } from '@/lib/linked-accounts/collective-copy';

import { HOST_TRANSFER_CONSENT_VERSION } from '@/lib/linked-accounts/replicas/hosting-constants';

export { HOST_TRANSFER_CONSENT_VERSION };

export const HOSTING_ACTIONS = [
  'offer_host',
  'accept_host',
  'decline_host',
  'cancel_host_transfer',
  'take_over_hosting',
] as const;
export type HostingAction = (typeof HOSTING_ACTIONS)[number];

export function isHostingAction(action: string): action is HostingAction {
  return (HOSTING_ACTIONS as readonly string[]).includes(action);
}

export interface HostingContext {
  admin: SupabaseClient;
  collectiveId: string;
  collectiveName: string;
  hostVenueId: string;
  venueId: string;
  venueName: string;
  userId: string | null;
}

export interface HostingInput {
  action: HostingAction;
  venueId?: string;
  consent_version?: string;
}

interface LifecycleRow {
  service_model: string;
  paused_at: string | null;
  pending_host_venue_id: string | null;
  host_transfer_at: string | null;
}

/**
 * Run one hosting action. Returns null when it went through (the route then answers with the
 * refreshed view), or the response to send when it did not.
 */
export async function runHostingAction(
  ctx: HostingContext,
  input: HostingInput,
): Promise<NextResponse | null> {
  const { data } = await ctx.admin
    .from('venue_collectives')
    .select('service_model, paused_at, pending_host_venue_id, host_transfer_at')
    .eq('id', ctx.collectiveId)
    .maybeSingle();
  const state = data as LifecycleRow | null;
  if (!state || state.service_model !== 'replicas') {
    return NextResponse.json(
      apiError(
        `${ctx.collectiveName} has not moved to shared services yet, so hosting cannot move this way.`,
        'COLLECTIVE_LEGACY_MODEL',
      ),
      { status: 409 },
    );
  }
  const names = { collective: ctx.collectiveName, host: ctx.venueName };
  const isHost = ctx.hostVenueId === ctx.venueId;

  if (input.action === 'offer_host') {
    if (!isHost) return notHost(ctx);
    if (!input.venueId) {
      return NextResponse.json({ error: 'Choose the venue to ask.' }, { status: 400 });
    }
    const { error } = await ctx.admin.rpc('collective_request_host_transfer', {
      p_collective_id: ctx.collectiveId,
      p_candidate_venue_id: input.venueId,
      p_actor_venue_id: ctx.venueId,
      p_actor_user_id: ctx.userId,
    });
    return error ? engineErrorResponse(error, names, 'Could not send the request.') : null;
  }

  if (input.action === 'accept_host' || input.action === 'take_over_hosting') {
    if (input.consent_version !== HOST_TRANSFER_CONSENT_VERSION) {
      return NextResponse.json(
        apiError(collectiveCopy('transfer.error.consent'), 'COLLECTIVE_CONSENT_REQUIRED'),
        { status: 409 },
      );
    }
  }

  if (input.action === 'accept_host') {
    const { error } = await ctx.admin.rpc('collective_accept_host_transfer', {
      p_collective_id: ctx.collectiveId,
      p_actor_venue_id: ctx.venueId,
      p_actor_user_id: ctx.userId,
      p_consent_version: input.consent_version,
    });
    return error ? engineErrorResponse(error, names, 'Could not accept the request.') : null;
  }

  if (input.action === 'decline_host' || input.action === 'cancel_host_transfer') {
    const declining = input.action === 'decline_host';
    if (declining && state.pending_host_venue_id !== ctx.venueId) {
      return NextResponse.json({ error: 'There is no request for your venue to host.' }, { status: 404 });
    }
    if (!declining && !isHost) return notHost(ctx);
    const pending = state.pending_host_venue_id;
    const { error } = await ctx.admin.rpc('collective_cancel_host_transfer', {
      p_collective_id: ctx.collectiveId,
      p_reason: declining ? 'declined' : 'host_cancelled',
      p_actor_venue_id: ctx.venueId,
      p_actor_user_id: ctx.userId,
    });
    if (error) return engineErrorResponse(error, names, 'Could not cancel the move.');
    // The other side hears it from the side that acted.
    const otherVenueId = declining ? ctx.hostVenueId : pending;
    if (otherVenueId) {
      await recordBell(
        ctx.admin,
        otherVenueId,
        collectiveCopy(declining ? 'notify.hostDeclined.subject' : 'notify.hostMoveCancelled.subject', {
          venue: ctx.venueName,
          collective: ctx.collectiveName,
        }),
        collectiveCopy(declining ? 'notify.hostDeclined.body' : 'notify.hostMoveCancelled.body', {
          venue: ctx.venueName,
          collective: ctx.collectiveName,
        }),
        { type: 'collective_host_transfer', collectiveId: ctx.collectiveId, actorVenueId: ctx.venueId },
      );
    }
    return null;
  }

  // take_over_hosting: only while the page is paused, by an active member, straight away.
  if (!state.paused_at) {
    return NextResponse.json(
      { error: `${ctx.collectiveName} has a host, so hosting moves by request, not take-over.` },
      { status: 409 },
    );
  }
  const { data: membership } = await ctx.admin
    .from('venue_collective_members')
    .select('id')
    .eq('collective_id', ctx.collectiveId)
    .eq('venue_id', ctx.venueId)
    .eq('status', 'active')
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({ error: `Only a venue in ${ctx.collectiveName} can take over hosting.` }, { status: 403 });
  }
  const { error } = await ctx.admin.rpc('collective_transfer_host', {
    p_collective_id: ctx.collectiveId,
    p_new_host_venue_id: ctx.venueId,
    p_actor_venue_id: ctx.venueId,
    p_actor_user_id: ctx.userId,
  });
  if (error) return engineErrorResponse(error, names, 'Could not take over hosting.');

  // Every copy was made due by the move; bring as many up to date as the budget allows.
  const { data: links } = await ctx.admin
    .from('collective_service_replicas')
    .select('id')
    .eq('collective_id', ctx.collectiveId)
    .is('released_at', null);
  await applyLinksInline(
    ctx.admin,
    (links ?? []).map((l) => l.id as string),
    { actorVenueId: ctx.venueId, actorUserId: ctx.userId, budgetMs: 8_000 },
  );
  return null;
}

function notHost(ctx: HostingContext): NextResponse {
  return NextResponse.json(
    apiError(`Only the host of ${ctx.collectiveName} can do this.`, 'COLLECTIVE_NOT_HOST'),
    { status: 403 },
  );
}

/** The older action, refused on the shared-services model with the reason. */
export function legacyTransferRefused(collectiveName: string): NextResponse {
  return NextResponse.json(
    apiError(
      `Hosting of ${collectiveName} moves by asking another venue to host, which it then accepts.`,
      'COLLECTIVE_HOST_CHANGE_REFUSED',
    ),
    { status: 409 },
  );
}
