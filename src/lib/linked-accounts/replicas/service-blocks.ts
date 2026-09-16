/**
 * The `collective` block the Services API adds to each service (plan Appendix E contract 5; W5).
 *
 * One read per venue, whether it hosts the collective or is a member, answering for every one of its
 * appointment services: what this service is to this venue (master, replica, retired, parked), which
 * fields the collective owns, how the copies are doing, and where guests cannot book it.
 *
 * Nothing here is written: the page shows it and the engine decides it.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { providerExclusionReason } from '@/lib/linked-accounts/replicas/derived-catalogue';
import {
  resolveCollectiveServiceStatus,
  type CollectiveHiddenReason,
  type CollectiveLinkState,
  type CollectiveServiceRole,
  type CollectiveServiceStatus,
} from '@/lib/linked-accounts/replicas/status';
import { parseVenueFeatureFlags, resolveAppointmentsFeatureFlag } from '@/lib/feature-flags/resolve';

export interface CollectiveServiceBlock {
  role: CollectiveServiceRole;
  collective_id: string;
  collective_name: string;
  host_venue_name: string;
  item_id: string | null;
  /** Columns the collective owns at a member; empty at the host, bar the two naming permissions. */
  locked_fields: string[];
  /** Columns the venue keeps for itself on a copy. */
  delegated_fields: string[];
  status: CollectiveServiceStatus;
  status_reason: string | null;
  last_applied_at: string | null;
  hidden_reasons: CollectiveHiddenReason[];
}

/** Forced false on a service the host has put on the page (D29), so the host cannot set them either. */
const MASTER_LOCKED_FIELDS = ['staff_may_customize_name', 'staff_may_customize_description'];

interface VenueFacts {
  name: string;
  suspended: boolean;
  chargesEnabled: boolean;
  formsOn: boolean;
}

export async function loadCollectiveServiceBlocks(
  admin: SupabaseClient,
  venueId: string,
): Promise<Map<string, CollectiveServiceBlock>> {
  const blocks = new Map<string, CollectiveServiceBlock>();
  const { data: stateRaw } = await admin.rpc('collective_venue_live_state', { p_venue_id: venueId });
  const state = (stateRaw ?? null) as { collective_id?: string; role?: 'host' | 'member'; paused?: boolean } | null;
  if (!state?.collective_id) return blocks;

  const collectiveId = state.collective_id;
  const isHost = state.role === 'host';
  const [{ data: collectiveRow }, { data: memberRows }, { data: itemRows }, { data: linkRows }, { data: classRows }] =
    await Promise.all([
      admin.from('venue_collectives').select('id, name, host_venue_id, paused_at').eq('id', collectiveId).maybeSingle(),
      admin.from('venue_collective_members').select('venue_id, suspended_at').eq('collective_id', collectiveId).eq('status', 'active'),
      admin.from('collective_service_items').select('id, master_service_id, status').eq('collective_id', collectiveId),
      admin
        .from('collective_service_replicas')
        .select('id, collective_service_item_id, venue_id, replica_service_id, applied_revision, desired_revision, attempts, last_error_code, last_applied_at')
        .eq('collective_id', collectiveId)
        .is('released_at', null),
      admin.from('collective_column_classes').select('column_name, class').eq('table_name', 'service_items'),
    ]);
  if (!collectiveRow) return blocks;

  const memberVenueIds = (memberRows ?? []).map((m) => m.venue_id as string);
  const { data: venueRows } = await admin
    .from('venues')
    .select('id, name, feature_flags, stripe_charges_enabled')
    .in('id', memberVenueIds.length > 0 ? memberVenueIds : [venueId]);
  const suspendedIds = new Set((memberRows ?? []).filter((m) => m.suspended_at != null).map((m) => m.venue_id as string));
  const venues = new Map<string, VenueFacts>(
    (venueRows ?? []).map((v) => [
      v.id as string,
      {
        name: (v.name as string) ?? 'Venue',
        suspended: suspendedIds.has(v.id as string),
        chargesEnabled: v.stripe_charges_enabled === true,
        formsOn: resolveAppointmentsFeatureFlag('compliance_records_enabled', parseVenueFeatureFlags(v.feature_flags)),
      },
    ]),
  );

  const items = new Map(
    (itemRows ?? []).map((i) => [i.id as string, { masterServiceId: (i.master_service_id as string | null) ?? null, active: i.status === 'active' }]),
  );
  const links = (linkRows ?? []).map((l) => ({
    itemId: l.collective_service_item_id as string,
    venueId: l.venue_id as string,
    replicaServiceId: (l.replica_service_id as string | null) ?? null,
    behind: Number(l.applied_revision) < Number(l.desired_revision),
    failing: Number(l.attempts) > 0 && l.last_error_code != null,
    lastAppliedAt: (l.last_applied_at as string | null) ?? null,
  }));

  // Which services take payment, need a form, or are staff bookings only.
  const serviceIds = [
    ...new Set([
      ...[...items.values()].map((i) => i.masterServiceId).filter((id): id is string => Boolean(id)),
      ...links.map((l) => l.replicaServiceId).filter((id): id is string => Boolean(id)),
    ]),
  ];
  const [{ data: serviceRows }, { data: formRows }, { data: venueWideRows }] = await Promise.all([
    admin.from('service_items').select('id, payment_requirement, is_bookable_online').in('id', serviceIds.length > 0 ? serviceIds : [venueId]),
    admin.from('service_compliance_requirements').select('service_item_id').in('service_item_id', serviceIds.length > 0 ? serviceIds : [venueId]),
    admin.from('service_compliance_requirements').select('venue_id').eq('scope', 'venue').in('venue_id', memberVenueIds.length > 0 ? memberVenueIds : [venueId]),
  ]);
  const paid = new Set((serviceRows ?? []).filter((r) => ((r.payment_requirement as string | null) ?? 'none') !== 'none').map((r) => r.id as string));
  const staffOnly = new Set((serviceRows ?? []).filter((r) => r.is_bookable_online === false).map((r) => r.id as string));
  const needsForm = new Set((formRows ?? []).map((r) => r.service_item_id as string));
  const venueWideForms = new Set((venueWideRows ?? []).map((r) => r.venue_id as string));

  const hostCols = (classRows ?? []).filter((c) => c.class === 'host').map((c) => c.column_name as string).sort();
  const ownCols = (classRows ?? []).filter((c) => c.class === 'venue' || c.class === 'not_copied').map((c) => c.column_name as string).sort();

  const paused = Boolean(state.paused ?? collectiveRow.paused_at);
  const hostVenueName = venues.get(collectiveRow.host_venue_id as string)?.name ?? 'the host';
  const base = {
    collective_id: collectiveId,
    collective_name: (collectiveRow.name as string) ?? 'your collective',
    host_venue_name: hostVenueName,
  };

  const hiddenReasonFor = (venueIdForFacts: string, serviceId: string | null, behind: boolean): CollectiveHiddenReason | null => {
    const facts = venues.get(venueIdForFacts);
    if (!facts || !serviceId) return null;
    const reason = providerExclusionReason({
      suspended: facts.suspended,
      behind,
      paid: paid.has(serviceId),
      chargesEnabled: facts.chargesEnabled,
      needsForm: needsForm.has(serviceId) || venueWideForms.has(venueIdForFacts),
      formsOn: facts.formsOn,
      staffOnly: staffOnly.has(serviceId),
    });
    return reason ? { venue_id: venueIdForFacts, venue_name: facts.name, reason } : null;
  };

  if (isHost) {
    for (const [itemId, item] of items) {
      if (!item.active || !item.masterServiceId) continue;
      const itemLinks = links.filter((l) => l.itemId === itemId);
      const linkStates: CollectiveLinkState[] = itemLinks.map((l) => ({
        venue_id: l.venueId,
        venue_name: venues.get(l.venueId)?.name ?? 'Venue',
        replica_service_id: l.replicaServiceId,
        behind: l.behind,
        failing: l.failing,
        last_applied_at: l.lastAppliedAt,
      }));
      const hidden = [
        hiddenReasonFor(venueId, item.masterServiceId, false),
        ...itemLinks.map((l) => hiddenReasonFor(l.venueId, l.replicaServiceId, l.behind)),
      ].filter((r): r is CollectiveHiddenReason => r !== null);
      blocks.set(item.masterServiceId, {
        ...base,
        role: 'master',
        item_id: itemId,
        locked_fields: MASTER_LOCKED_FIELDS,
        delegated_fields: [],
        hidden_reasons: hidden,
        ...resolveCollectiveServiceStatus({ role: 'master', paused, links: linkStates, hiddenReasons: hidden }),
      });
    }
  } else {
    for (const link of links.filter((l) => l.venueId === venueId && l.replicaServiceId)) {
      const item = items.get(link.itemId);
      const hidden = [hiddenReasonFor(venueId, link.replicaServiceId, link.behind)].filter(
        (r): r is CollectiveHiddenReason => r !== null,
      );
      const linkStates: CollectiveLinkState[] = [
        {
          venue_id: venueId,
          venue_name: venues.get(venueId)?.name ?? 'Your venue',
          replica_service_id: link.replicaServiceId,
          behind: link.behind,
          failing: link.failing,
          last_applied_at: link.lastAppliedAt,
        },
      ];
      const role: CollectiveServiceRole = item?.active ? 'replica' : 'retired';
      blocks.set(link.replicaServiceId!, {
        ...base,
        role,
        item_id: link.itemId,
        locked_fields: hostCols,
        delegated_fields: ownCols,
        hidden_reasons: hidden,
        ...resolveCollectiveServiceStatus({ role, paused, links: linkStates, hiddenReasons: hidden }),
      });
    }
  }

  // Everything else the venue offers is parked while it is live (D2).
  const { data: bookableRaw } = await admin.rpc('collective_bookable_service_ids', { p_venue_id: venueId });
  const bookable = new Set(Array.isArray(bookableRaw) ? (bookableRaw as string[]) : []);
  const { data: ownServices } = await admin.from('service_items').select('id').eq('venue_id', venueId).eq('is_active', true);
  for (const row of ownServices ?? []) {
    const id = row.id as string;
    if (blocks.has(id) || bookable.has(id)) continue;
    blocks.set(id, {
      ...base,
      role: 'parked',
      item_id: null,
      locked_fields: [],
      delegated_fields: [],
      hidden_reasons: [],
      status: paused ? 'paused' : 'hidden',
      status_reason: paused
        ? 'The collective page is paused, so nothing is bookable on it.'
        : `This service is not on the ${base.collective_name} page, so it cannot take new bookings while you are part of ${base.collective_name}. Existing bookings are not affected.`,
      last_applied_at: null,
    });
  }

  return blocks;
}
