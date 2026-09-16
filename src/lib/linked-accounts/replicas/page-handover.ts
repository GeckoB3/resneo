/**
 * Whether a venue's own booking page hands over to its collective's page (plan §6.9, RT2-3, D3,
 * D44; UX spec `bp.status.*`, `bp.reason.*`, `bm.redirect.otherModels`; W10).
 *
 * The rule is derived from state and never stored (`solo_page_behavior` is not read on this model):
 *
 *   - the host's page hands over while the collective page is live and at least one host calendar
 *     is listed for guests;
 *   - a member's page also needs every one of its replicas converged, so a member is never sent to
 *     a page that cannot yet show its services;
 *   - otherwise the own page shows, and the Booking Page tab says why.
 *
 * "Listed" is read from the public catalogue itself, so a calendar the page leaves out (payments,
 * forms, suspended, behind, staff only) does not count. Only shared-services collectives are
 * answered here; the older model keeps `resolveCombinedSlugClaim`'s stored choice until it migrates.
 *
 * A venue that also runs classes, events or bookable rooms keeps its own page for those: its bare
 * address is not redirected, and the appointments tab there becomes a card that links to the
 * collective page. Appointment deep links (a calendar address, a named service) still hand over.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadPublicCombinedCatalogue } from '@/lib/linked-accounts/catalogue';
import { findCollectiveLockForVenue } from '@/lib/linked-accounts/collective-venue-locks';
import { OTHER_MODEL_COLUMNS, otherBookingModelList } from '@/lib/linked-accounts/collective-other-models';

export type HandoverReason = 'notLive' | 'noCalendars' | 'paused' | 'settingUp' | 'unavailable';

export interface OwnPageHandover {
  collectiveId: string;
  collectiveName: string;
  /** The collective's own address slug, `/book/c/{slug}` and `/embed/c/{slug}`. */
  collectiveSlug: string;
  hostVenueId: string;
  hostName: string;
  isHost: boolean;
  /** Where guests reach the collective page: `/book/c/{slug}`, or an adopted venue's address. */
  publicPath: string;
  /** True when this venue's own appointment links go to the collective page. */
  redirect: boolean;
  /** Why the own page shows, when it does. */
  reason: HandoverReason | null;
  /** "classes and events" when the venue runs other booking types, which stay on its own page. */
  otherModels: string | null;
  /** The venue's own page address, `/book/{slug}`. */
  ownPath: string | null;
}

type Row = Record<string, unknown>;

export async function resolveOwnPageHandover(admin: SupabaseClient, venueId: string): Promise<OwnPageHandover | null> {
  const lock = await findCollectiveLockForVenue(admin, venueId);
  if (!lock) return null;
  const { data: collective } = await admin
    .from('venue_collectives')
    .select('*')
    .eq('id', lock.collectiveId)
    .maybeSingle();
  if (!collective || (collective as Row).service_model !== 'replicas') return null;
  const row = collective as Row;
  const hostVenueId = row.host_venue_id as string;

  const venueIds = [...new Set([venueId, hostVenueId, (row.adopted_venue_id as string | null) ?? ''])].filter(Boolean);
  const { data: venues } = await admin.from('venues').select(`id, name, slug, ${OTHER_MODEL_COLUMNS}`).in('id', venueIds);
  const venueById = new Map(((venues ?? []) as Row[]).map((v) => [v.id as string, v]));
  const me = venueById.get(venueId);
  const adoptedSlug =
    row.slug_strategy === 'adopt_member' && row.adopted_venue_id
      ? ((venueById.get(row.adopted_venue_id as string)?.slug as string | null | undefined) ?? null)
      : null;

  const base: Omit<OwnPageHandover, 'redirect' | 'reason'> = {
    collectiveId: lock.collectiveId,
    collectiveName: (row.name as string | null) ?? lock.collectiveName,
    collectiveSlug: row.slug as string,
    hostVenueId,
    hostName: (venueById.get(hostVenueId)?.name as string | null | undefined) ?? 'The host',
    isHost: hostVenueId === venueId,
    publicPath: adoptedSlug ? `/book/${adoptedSlug}` : `/book/c/${row.slug as string}`,
    otherModels: otherBookingModelList(me),
    ownPath: me?.slug ? `/book/${me.slug as string}` : null,
  };
  const showOwn = (reason: HandoverReason): OwnPageHandover => ({ ...base, redirect: false, reason });

  if (row.page_mode !== 'unified_catalog') return showOwn('notLive');
  if (row.paused_at) return showOwn('paused');

  let catalogue: Awaited<ReturnType<typeof loadPublicCombinedCatalogue>>;
  try {
    catalogue = await loadPublicCombinedCatalogue(admin, lock.collectiveId);
  } catch {
    return showOwn('unavailable');
  }
  // Live as the page itself decides: two eligible venues and something to book.
  if (!catalogue || Object.keys(catalogue.venueData).length < 2 || catalogue.items.length === 0) {
    return showOwn('notLive');
  }

  if (!base.isHost) {
    const { data: links } = await admin
      .from('collective_service_replicas')
      .select('applied_revision, desired_revision')
      .eq('collective_id', lock.collectiveId)
      .eq('venue_id', venueId)
      .is('released_at', null);
    const behind = ((links ?? []) as Row[]).some((l) => Number(l.applied_revision) < Number(l.desired_revision));
    if (behind) return showOwn('settingUp');
  }

  const listed = catalogue.items.some((item) => item.providers.some((p) => p.venueId === venueId));
  if (!listed) return showOwn('noCalendars');
  return { ...base, redirect: true, reason: null };
}

/**
 * The collective offering a venue's own service id stands for, or null. The host's service is an
 * offering's master; a member's is a replica. A parked or unlisted service has no offering on the
 * page, so the guest lands on the service list instead (RT2-10, RT2-22, D2).
 */
export async function offeringForOwnService(
  admin: SupabaseClient,
  collectiveId: string,
  venueId: string,
  serviceId: string,
): Promise<string | null> {
  const catalogue = await loadPublicCombinedCatalogue(admin, collectiveId);
  const listed = new Set((catalogue?.items ?? []).filter((i) => i.providers.length > 0).map((i) => i.id));
  if (listed.has(serviceId)) return serviceId;
  const [{ data: masters }, { data: replicas }] = await Promise.all([
    admin
      .from('collective_service_items')
      .select('id')
      .eq('collective_id', collectiveId)
      .eq('status', 'active')
      .eq('master_service_id', serviceId),
    admin
      .from('collective_service_replicas')
      .select('collective_service_item_id')
      .eq('collective_id', collectiveId)
      .eq('venue_id', venueId)
      .eq('replica_service_id', serviceId)
      .is('released_at', null),
  ]);
  const candidates = [
    ...((masters ?? []) as Row[]).map((m) => m.id as string),
    ...((replicas ?? []) as Row[]).map((r) => r.collective_service_item_id as string),
  ];
  return candidates.find((id) => listed.has(id)) ?? null;
}

/** The query parameters a handover keeps, so the guest does not lose their place. */
const KEPT_PARAMS = ['date', 'time', 'start'] as const;

/**
 * The collective page address for a guest arriving at a venue's own appointment link, keeping the
 * date, time and entry step, the calendar (`?calendar=`) and the service translated to its
 * offering. A service with no offering is dropped, and `start=time` with it, since a time step
 * needs a service.
 */
export async function handoverUrl(
  admin: SupabaseClient,
  handover: OwnPageHandover,
  venueId: string,
  query: { get(name: string): string | null },
  calendarId?: string | null,
): Promise<string> {
  const out = new URLSearchParams();
  const serviceId = query.get('service_id')?.trim() || null;
  const offering = serviceId ? await offeringForOwnService(admin, handover.collectiveId, venueId, serviceId) : null;
  if (offering) out.set('service_id', offering);
  for (const key of KEPT_PARAMS) {
    const value = query.get(key);
    if (!value) continue;
    if (key === 'start' && value === 'time' && !offering) continue;
    out.set(key, value);
  }
  if (calendarId) out.set('calendar', calendarId);
  const qs = out.toString();
  return qs ? `${handover.publicPath}?${qs}` : handover.publicPath;
}
