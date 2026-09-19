/**
 * Creating a collective with its first invitations (UX spec J1; plan §6.7), factored out of
 * `POST /api/venue/collectives` so the one-call setup (`link-setup.ts`) creates the same rows with the
 * same checks (Docs/link-and-collective-setup-wizard-plan.md, L3).
 *
 * The one option is the mesh gate. The Create dialog admits a venue on an accepted link that grants
 * full access both ways. The setup flow admits it on the pending link it has just created, which
 * grants the same, and the engine checks the accepted link again when the venue joins.
 */
import { NextResponse } from 'next/server';
import type { LinkAdminCtx } from '@/lib/linked-accounts/link-request';
import { newCollectiveServiceModel } from '@/lib/platform/platform-settings';
import { loadCollectiveViewsForVenue } from '@/lib/linked-accounts/collectives';
import { checkCombinedEligibility } from '@/lib/linked-accounts/catalogue';
import { notifyCollectiveInvitation } from '@/lib/linked-accounts/notifications';
import { exclusivityRefusal, noAppointmentsRefusal } from '@/lib/linked-accounts/collective-venue-locks';
import { releaseDissolvedAddress } from '@/lib/linked-accounts/replicas/dissolved-page';

/**
 * Which step of the create wizard a refusal belongs to (UI-C-01), so the wizard shows it there:
 * `name` and `slug` on step 1, `venues` on step 2, `collective` and `plan` wherever the host is.
 */
export type CreateCollectiveField = 'name' | 'slug' | 'venues' | 'collective' | 'plan';

export interface CreateCollectiveInput {
  name: string;
  slug: string;
  branding?: Record<string, unknown>;
  serviceGrouping?: 'by_practitioner' | 'by_service_type';
  inviteVenueIds: string[];
}

export type CreateCollectiveResult =
  | { ok: true; collectiveId: string; name: string; slug: string }
  | { ok: false; response: NextResponse };

async function withField(response: NextResponse, field: CreateCollectiveField): Promise<NextResponse> {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return NextResponse.json({ ...body, field }, { status: response.status });
}

const refuse = (error: string, status: number, field: CreateCollectiveField, extra?: Record<string, unknown>) =>
  ({ ok: false, response: NextResponse.json({ error, field, ...(extra ?? {}) }, { status }) }) as const;

export async function createCollectiveWithInvites(
  ctx: LinkAdminCtx,
  input: CreateCollectiveInput,
  opts: { skipMeshCheck?: boolean; notify?: boolean } = {},
): Promise<CreateCollectiveResult> {
  if (!ctx.eligibility.canCreate) {
    return refuse(ctx.eligibility.reason ?? 'Collectives cannot be created right now.', 403, 'plan');
  }

  // One collective per venue: refuse a second when this venue already hosts or belongs to a live
  // (non-dissolved) collective. The UI hides the create button in this case; this guards a stale
  // client or a direct API call.
  const existingViews = await loadCollectiveViewsForVenue(ctx.admin, ctx.venueId);
  if (existingViews.some((c) => c.status !== 'dissolved')) {
    return refuse(
      'Your venue is already in a collective. Add members from the combined page’s Members tab, or dissolve it first.',
      409,
      'collective',
    );
  }

  const slug = input.slug.toLowerCase();
  const inviteVenueIds = [...new Set(input.inviteVenueIds)].filter((id) => id !== ctx.venueId);
  if (inviteVenueIds.length === 0) return refuse('Invite at least one other linked venue.', 400, 'venues');

  // One live collective per venue (§6.7): an invitee already in one is refused by name.
  const taken = await exclusivityRefusal(ctx.admin, inviteVenueIds, undefined, 'invite');
  if (taken) return { ok: false, response: await withField(taken, 'venues') };
  const noAppointments = await noAppointmentsRefusal(ctx.admin, inviteVenueIds);
  if (noAppointments) return { ok: false, response: await withField(noAppointments, 'venues') };

  // Slug uniqueness among collectives.
  const { data: slugTaken } = await ctx.admin
    .from('venue_collectives')
    .select('id, status, host_venue_id')
    .eq('slug', slug)
    .maybeSingle();
  // DL4: an ended collective keeps its address for its neutral page, but its own host may take it
  // back for a new collective straight away. Anyone else waits for the 90 days.
  if (slugTaken && slugTaken.status === 'dissolved' && slugTaken.host_venue_id === ctx.venueId) {
    await releaseDissolvedAddress(ctx.admin, slugTaken.id as string);
  } else if (slugTaken) {
    return refuse('That booking-page address is already in use. Choose another.', 409, 'slug');
  }

  // Name uniqueness among active collectives (case-insensitive).
  const trimmedName = input.name.trim();
  const { data: nameTaken } = await ctx.admin
    .from('venue_collectives')
    .select('id')
    .ilike('name', trimmedName)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();
  if (nameTaken) return refuse('A collective with that name already exists. Choose another.', 409, 'name');

  // §7.2.1: a dissolved collective's name is held for 30 days before reuse, except by the venue that
  // hosted it. `updated_at` is bumped on dissolution, so it stands in for the dissolution time.
  const cooldownCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: recentlyDissolved } = await ctx.admin
    .from('venue_collectives')
    .select('id')
    .ilike('name', trimmedName)
    .eq('status', 'dissolved')
    .gte('updated_at', cooldownCutoff)
    .neq('host_venue_id', ctx.venueId)
    .limit(1)
    .maybeSingle();
  if (recentlyDissolved) return refuse('That name isn’t available yet. Please choose another.', 409, 'name');

  // The D4 write gate and the D8 single-timezone check across every member (host and invitees).
  const eligibility = await checkCombinedEligibility(ctx.admin, [ctx.venueId, ...inviteVenueIds], {
    hostVenueId: ctx.venueId,
    skipMesh: opts.skipMeshCheck === true,
  });
  if (!eligibility.ok) {
    return refuse(
      eligibility.reason ?? 'These venues can’t run a combined page yet.',
      eligibility.code ? 409 : 400,
      'venues',
      eligibility.code ? { code: eligibility.code } : undefined,
    );
  }

  const { data: collective, error: insertErr } = await ctx.admin
    .from('venue_collectives')
    .insert({
      slug,
      name: trimmedName,
      host_venue_id: ctx.venueId,
      branding: input.branding ?? {},
      service_grouping: input.serviceGrouping ?? 'by_practitioner',
      status: 'active',
      page_mode: 'unified_catalog',
      timezone: eligibility.timezone,
      // D37: the platform console decides which model a new collective starts on.
      service_model: await newCollectiveServiceModel(ctx.admin),
    })
    .select('id')
    .single();
  if (insertErr || !collective) {
    console.error('createCollectiveWithInvites insert failed:', insertErr?.message);
    return { ok: false, response: NextResponse.json({ error: 'Failed to create collective.' }, { status: 500 }) };
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
  const { error: membersErr } = await ctx.admin.from('venue_collective_members').insert(memberRows);
  if (membersErr) {
    console.error('createCollectiveWithInvites members failed:', membersErr.message);
    await ctx.admin.from('venue_collectives').delete().eq('id', collectiveId);
    return { ok: false, response: NextResponse.json({ error: 'Failed to invite venues.' }, { status: 500 }) };
  }

  if (opts.notify !== false) {
    await Promise.allSettled(
      inviteVenueIds.map((venueId) => notifyCollectiveInvitation(ctx.admin, venueId, trimmedName, ctx.venue.name)),
    );
  }

  return { ok: true, collectiveId, name: trimmedName, slug };
}
