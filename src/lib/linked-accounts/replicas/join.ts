/**
 * Joining a collective on the shared-services model (plan §6.7 "Accept (join)"; Appendix E
 * contract 6; UX spec `join.*`; W7).
 *
 *   loadJoinPreview   what the invited venue has to decide before it joins: its services that share
 *                     a name with one on the page (use mine, or add the host's as new), its other
 *                     services (park, or ask the host to add), its forms that share a name with one
 *                     the page asks for (use my existing, or use theirs), and anything that stops it
 *                     joining at all;
 *   runJoin           one engine call with those answers and the consent, then the first copies,
 *                     and the notices (N3 to the others; N28 to the host for each "ask").
 *
 * Names are matched one way, `lower(btrim(name))`, on both sides, so the preview and the engine
 * never disagree about what counts as the same service.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api/error-codes';
import { collectiveCopy } from '@/lib/linked-accounts/collective-copy';
import { notifyVenue } from '@/lib/linked-accounts/notifications';
import { recordBell } from '@/lib/linked-accounts/replicas/collective-notices';
import { engineErrorResponse } from '@/lib/linked-accounts/replicas/host-route-helpers';
import { applyLinksInline } from '@/lib/linked-accounts/replicas/inline-apply';
import { JOIN_CONSENT_VERSION } from '@/lib/linked-accounts/replicas/hosting-constants';
import { parseVenueFeatureFlags, resolveAppointmentsFeatureFlag } from '@/lib/feature-flags/resolve';

/** The one normaliser for "the same name" (plan contract 6). */
export const sameName = (name: string | null | undefined): string => (name ?? '').trim().toLowerCase();

export interface JoinOption {
  id: string;
  name: string;
}

export interface JoinSameName {
  item_id: string;
  host_service_id: string;
  name: string;
  my_service_id: string;
  my_options: JoinOption[];
  host_options: JoinOption[];
}

export interface JoinPreview {
  consent_version: string;
  collective_name: string;
  host_name: string;
  /** Why the venue cannot join, in words, or null. */
  blocked: string | null;
  services_to_set_up: number;
  same_name: JoinSameName[];
  own_services: JoinOption[];
  forms: { host_type_id: string; name: string; my_type_id: string }[];
  warnings: { no_stripe_paid_services: number; form_services: number; forms_off: boolean };
}

type Row = Record<string, unknown>;

/** The blocker the engine names, as the invited venue reads it (UX spec `join.block.*`). */
export function joinBlockerWords(
  blocker: string | null,
  names: { collective: string; yourTimezone?: string | null; timezone?: string | null; yourCurrency?: string | null; currency?: string | null },
): string | null {
  if (!blocker) return null;
  if (blocker === 'timezone') {
    return collectiveCopy('join.block.timezone', {
      yourTimezone: names.yourTimezone ?? 'another timezone',
      collective: names.collective,
      timezone: names.timezone ?? 'another timezone',
    });
  }
  if (blocker === 'currency') {
    return collectiveCopy('join.block.currency', {
      yourCurrency: names.yourCurrency ?? 'another currency',
      collective: names.collective,
      currency: names.currency ?? 'another currency',
    });
  }
  if (blocker === 'exclusivity') return collectiveCopy('join.block.otherCollectiveGeneric');
  if (blocker === 'booking_model') return collectiveCopy('join.block.bookingModel', { collective: names.collective });
  if (blocker === 'mesh') return collectiveCopy('join.block.links', { collective: names.collective });
  return collectiveCopy('join.block.unknown');
}

export async function loadJoinPreview(
  admin: SupabaseClient,
  collectiveId: string,
  venueId: string,
): Promise<JoinPreview | null> {
  const { data: collective } = await admin
    .from('venue_collectives')
    .select('id, name, host_venue_id, service_model, status')
    .eq('id', collectiveId)
    .maybeSingle();
  if (!collective || collective.service_model !== 'replicas' || collective.status !== 'active') return null;
  const hostId = collective.host_venue_id as string;

  const [{ data: venues }, { data: items }, { data: blocker }] = await Promise.all([
    admin
      .from('venues')
      .select('id, name, timezone, currency, stripe_charges_enabled, feature_flags')
      .in('id', [hostId, venueId]),
    admin
      .from('collective_service_items')
      .select('id, master_service_id')
      .eq('collective_id', collectiveId)
      .eq('status', 'active'),
    admin.rpc('collective_join_blocker', { p_collective_id: collectiveId, p_venue_id: venueId }),
  ]);
  const host = (venues ?? []).find((v) => v.id === hostId) as Row | undefined;
  const me = (venues ?? []).find((v) => v.id === venueId) as Row | undefined;
  const masterIds = (items ?? []).map((i) => i.master_service_id as string).filter(Boolean);

  const [{ data: masters }, { data: mine }, { data: hostForms }, { data: myForms }] = await Promise.all([
    masterIds.length > 0
      ? admin.from('service_items').select('id, name, payment_requirement').in('id', masterIds)
      : Promise.resolve({ data: [] as Row[] }),
    admin.from('service_items').select('id, name').eq('venue_id', venueId).eq('is_active', true),
    masterIds.length > 0
      ? admin
          .from('service_compliance_requirements')
          .select('service_item_id, compliance_types!compliance_type_id (id, name)')
          .in('service_item_id', masterIds)
      : Promise.resolve({ data: [] as Row[] }),
    admin
      .from('compliance_types')
      .select('id, name, managed_by_collective_id')
      .eq('venue_id', venueId)
      .is('archived_at', null),
  ]);

  // A service the venue already holds as a copy is not its own to choose about.
  const myIds = (mine ?? []).map((s) => s.id as string);
  const { data: myCopies } = myIds.length > 0
    ? await admin.from('collective_service_replicas').select('replica_service_id').in('replica_service_id', myIds).is('released_at', null)
    : { data: [] as Row[] };
  const copies = new Set((myCopies ?? []).map((r) => r.replica_service_id as string));
  const own = (mine ?? []).filter((s) => !copies.has(s.id as string));

  const itemByMaster = new Map((items ?? []).map((i) => [i.master_service_id as string, i.id as string]));
  const sameNames: JoinSameName[] = [];
  const matchedMine = new Set<string>();
  for (const master of masters ?? []) {
    const match = own.find((s) => sameName(s.name as string) === sameName(master.name as string) && !matchedMine.has(s.id as string));
    if (!match) continue;
    matchedMine.add(match.id as string);
    sameNames.push({
      item_id: itemByMaster.get(master.id as string)!,
      host_service_id: master.id as string,
      name: master.name as string,
      my_service_id: match.id as string,
      my_options: [],
      host_options: [],
    });
  }
  if (sameNames.length > 0) {
    const { data: variants } = await admin
      .from('service_variants')
      .select('id, name, service_item_id, is_active')
      .in('service_item_id', sameNames.flatMap((s) => [s.my_service_id, s.host_service_id]));
    for (const pair of sameNames) {
      const of = (serviceId: string) =>
        (variants ?? [])
          .filter((v) => v.service_item_id === serviceId && v.is_active !== false)
          .map((v) => ({ id: v.id as string, name: v.name as string }));
      pair.my_options = of(pair.my_service_id);
      pair.host_options = of(pair.host_service_id);
    }
  }

  const hostFormList = new Map<string, string>();
  for (const row of hostForms ?? []) {
    const joined = row.compliance_types as { id?: string; name?: string } | { id?: string; name?: string }[] | null;
    const type = Array.isArray(joined) ? joined[0] : joined;
    if (type?.id && type.name) hostFormList.set(type.id, type.name);
  }
  const forms: JoinPreview['forms'] = [];
  for (const [hostTypeId, name] of hostFormList) {
    const match = (myForms ?? []).find(
      (f) => !f.managed_by_collective_id && sameName(f.name as string) === sameName(name),
    );
    if (match) forms.push({ host_type_id: hostTypeId, name, my_type_id: match.id as string });
  }

  const paidServices = (masters ?? []).filter((m) => ((m.payment_requirement as string | null) ?? 'none') !== 'none').length;
  const formServices = new Set((hostForms ?? []).map((r) => r.service_item_id as string)).size;
  const formsOn = resolveAppointmentsFeatureFlag('compliance_records_enabled', parseVenueFeatureFlags(me?.feature_flags));

  return {
    consent_version: JOIN_CONSENT_VERSION,
    collective_name: (collective.name as string) ?? 'the collective',
    host_name: (host?.name as string) ?? 'The host',
    blocked: joinBlockerWords((blocker as string | null) ?? null, {
      collective: (collective.name as string) ?? 'the collective',
      yourTimezone: (me?.timezone as string | null) ?? null,
      timezone: (host?.timezone as string | null) ?? null,
      yourCurrency: (me?.currency as string | null) ?? null,
      currency: (host?.currency as string | null) ?? null,
    }),
    services_to_set_up: masterIds.length,
    same_name: sameNames,
    own_services: own
      .filter((s) => !matchedMine.has(s.id as string))
      .map((s) => ({ id: s.id as string, name: s.name as string })),
    forms,
    warnings: {
      no_stripe_paid_services: me?.stripe_charges_enabled === true ? 0 : paidServices,
      form_services: formServices,
      forms_off: !formsOn,
    },
  };
}

export interface JoinChoices {
  same_name_choices?: {
    item_id: string;
    choice: 'add_new' | 'use_mine';
    my_service_id?: string;
    option_map?: { my_variant_id: string; host_variant_id: string | null }[];
  }[];
  own_service_choices?: { service_id: string; choice: 'ask' | 'park' }[];
  form_choices?: { host_type_id: string; choice: 'use_existing' | 'use_theirs'; my_type_id?: string }[];
}

export interface JoinContext {
  admin: SupabaseClient;
  collectiveId: string;
  collectiveName: string;
  hostVenueId: string;
  memberId: string;
  venueId: string;
  venueName: string;
  userId: string | null;
}

/** Join, with the venue's answers. Null when it went through; otherwise the response to send. */
export async function runJoin(
  ctx: JoinContext,
  input: JoinChoices & { consent_version?: string },
): Promise<NextResponse | null> {
  if (input.consent_version !== JOIN_CONSENT_VERSION) {
    return NextResponse.json(apiError(collectiveCopy('join.error.consent'), 'COLLECTIVE_CONSENT_REQUIRED'), {
      status: 409,
    });
  }
  const useMine = (input.same_name_choices ?? []).find((c) => c.choice === 'use_mine' && !c.my_service_id);
  if (useMine) {
    return NextResponse.json({ error: 'Choose which of your services to use.' }, { status: 400 });
  }

  // The engine re-checks these under its lock; checking first means the venue reads the reason.
  const { data: blocker } = await ctx.admin.rpc('collective_join_blocker', {
    p_collective_id: ctx.collectiveId,
    p_venue_id: ctx.venueId,
  });
  if (blocker) {
    const preview = await loadJoinPreview(ctx.admin, ctx.collectiveId, ctx.venueId);
    return NextResponse.json(
      { error: preview?.blocked ?? joinBlockerWords(blocker as string, { collective: ctx.collectiveName }) },
      { status: 409 },
    );
  }

  const { data, error } = await ctx.admin.rpc('collective_join_member', {
    p_member_id: ctx.memberId,
    p_consent_version: input.consent_version,
    p_choices: {
      same_name_choices: input.same_name_choices ?? [],
      own_service_choices: input.own_service_choices ?? [],
      form_choices: input.form_choices ?? [],
    },
    p_actor_venue_id: ctx.venueId,
    p_actor_user_id: ctx.userId,
  });
  if (error) return engineErrorResponse(error, { collective: ctx.collectiveName }, 'Could not join. Please try again.');

  // The first copies: as many as the budget allows now, the rest from the cron within minutes.
  const links = ((data as { links?: { link_id: string }[] } | null)?.links ?? []).map((l) => l.link_id);
  await applyLinksInline(ctx.admin, links, {
    job: 'collective-join',
    actorVenueId: ctx.venueId,
    actorUserId: ctx.userId,
    budgetMs: 8_000,
  });

  await sendJoinNotices(ctx, input);
  return null;
}

/** N3 to the host (email and bell) and the other members (bell); N28 to the host per "ask". */
async function sendJoinNotices(ctx: JoinContext, input: JoinChoices): Promise<void> {
  const subject = collectiveCopy('notify.joined.subject', { venue: ctx.venueName, collective: ctx.collectiveName });
  const body = collectiveCopy('notify.joined.body', { venue: ctx.venueName, collective: ctx.collectiveName });
  await notifyVenue(
    ctx.admin,
    ctx.hostVenueId,
    subject,
    { heading: subject, paragraphs: [body] },
    { type: 'collective_joined', category: 'collective', collectiveId: ctx.collectiveId, actorVenueId: ctx.venueId },
  ).catch(() => undefined);

  const { data: others } = await ctx.admin
    .from('venue_collective_members')
    .select('venue_id')
    .eq('collective_id', ctx.collectiveId)
    .eq('status', 'active');
  for (const other of others ?? []) {
    const id = other.venue_id as string;
    if (id === ctx.hostVenueId || id === ctx.venueId) continue;
    await recordBell(ctx.admin, id, subject, body, {
      type: 'collective_joined',
      collectiveId: ctx.collectiveId,
      actorVenueId: ctx.venueId,
    });
  }

  const asked = (input.own_service_choices ?? []).filter((c) => c.choice === 'ask').map((c) => c.service_id);
  if (asked.length === 0) return;
  const { data: services } = await ctx.admin.from('service_items').select('id, name').in('id', asked);
  for (const service of services ?? []) {
    const askSubject = collectiveCopy('notify.suggestion.subject', {
      venue: ctx.venueName,
      service: service.name as string,
      collective: ctx.collectiveName,
    });
    const askBody = collectiveCopy('notify.suggestion.body', {
      venue: ctx.venueName,
      service: service.name as string,
      collective: ctx.collectiveName,
    });
    await notifyVenue(
      ctx.admin,
      ctx.hostVenueId,
      askSubject,
      { heading: askSubject, paragraphs: [askBody] },
      { type: 'collective_suggestion', category: 'collective', collectiveId: ctx.collectiveId, actorVenueId: ctx.venueId },
    ).catch(() => undefined);
  }
}
