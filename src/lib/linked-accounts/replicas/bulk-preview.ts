/**
 * What each venue's guests would see if the host saved this (UX spec §2 item 15 "Preview before you
 * push"; plan Appendix E contract 13's preview half; W5).
 *
 * The host's changes reach other people's booking pages, and until now the only preview in the
 * whole flow belonged to a member, at accept. This answers the question before the save: venue by
 * venue, what would be bookable, and what would not be, and why.
 *
 * Pure, and it writes nothing: the staged operations are applied to a copy of what the collective
 * looks like now. That is also what makes it honest about the operations it cannot foresee, which
 * are called out below rather than guessed at.
 */
import type { CollectiveCalendarGroup } from '@/lib/linked-accounts/replicas/host-calendars';
import type { CollectiveServiceBlock } from '@/lib/linked-accounts/replicas/service-blocks';
import type { ProviderExclusion } from '@/lib/linked-accounts/replicas/derived-catalogue';
import type { BulkOp } from '@/lib/linked-accounts/replicas/bulk-ops';

export type PreviewReason = ProviderExclusion | 'no_calendars';

export interface PreviewService {
  service_id: string;
  name: string;
}

export interface PreviewHiddenService extends PreviewService {
  reason: PreviewReason;
}

export interface PreviewVenue {
  venue_id: string;
  venue_name: string;
  is_host: boolean;
  /** What guests would be able to book with this venue on the collective page. */
  shows: PreviewService[];
  /** What is on the page but would not be bookable here, and why. */
  hides: PreviewHiddenService[];
}

export interface BulkPreviewInput {
  services: { id: string; name: string; collective: CollectiveServiceBlock | null }[];
  groups: CollectiveCalendarGroup[];
  ops: BulkOp[];
}

/** Venue by venue, what the collective page would offer after these changes. */
export function previewBulkOps(input: BulkPreviewInput): { venues: PreviewVenue[] } {
  const byService = new Map(input.services.map((s) => [s.id, s]));

  /** Which services would be on the page, and under which offering. */
  const onPage = new Map<string, { name: string; itemId: string | null }>();
  for (const service of input.services) {
    if (service.collective?.role === 'master') {
      onPage.set(service.id, { name: service.name, itemId: service.collective.item_id });
    }
  }
  for (const op of input.ops) {
    if (op.op === 'offer') {
      const service = byService.get(op.service_id);
      if (!service) continue;
      onPage.set(op.service_id, {
        name: service.name,
        // A service being put on the page has no offering yet, so nothing can be assigned to it
        // in this preview: members show it only once the host chooses their calendars.
        itemId: service.collective?.item_id ?? null,
      });
    }
    if (op.op === 'withdraw') onPage.delete(op.service_id);
  }

  /** (venue, item) -> how many active calendars would offer it. */
  const offering = new Map<string, Set<string>>();
  const key = (venueId: string, itemId: string) => `${venueId}:${itemId}`;
  for (const group of input.groups) {
    for (const calendar of group.calendars) {
      if (!calendar.is_active) continue;
      for (const assignment of calendar.assigned) {
        const k = key(group.venue_id, assignment.item_id);
        offering.set(k, (offering.get(k) ?? new Set()).add(calendar.id));
      }
    }
  }
  for (const op of input.ops) {
    if (op.op !== 'assign' && op.op !== 'unassign') continue;
    const service = byService.get(op.service_id);
    const itemId = service?.collective?.item_id ?? null;
    if (!itemId) continue;
    const group = input.groups.find((g) => g.venue_id === op.venue_id);
    const calendar = group?.calendars.find((c) => c.id === op.calendar_id);
    // A calendar that is turned off cannot take bookings whatever the host stages for it.
    if (!calendar?.is_active) continue;
    const k = key(op.venue_id, itemId);
    const set = new Set(offering.get(k) ?? []);
    if (op.op === 'assign') set.add(op.calendar_id);
    else set.delete(op.calendar_id);
    offering.set(k, set);
  }

  const venues: PreviewVenue[] = input.groups.map((group) => {
    const shows: PreviewService[] = [];
    const hides: PreviewHiddenService[] = [];
    for (const [serviceId, service] of onPage) {
      const block = byService.get(serviceId)?.collective ?? null;
      const itemId = service.itemId;
      const calendars = itemId ? (offering.get(key(group.venue_id, itemId))?.size ?? 0) : 0;
      if (calendars === 0) {
        hides.push({ service_id: serviceId, name: service.name, reason: 'no_calendars' });
        continue;
      }
      // Why this venue's guests would not see it, as the collective already reports it today.
      const reason = block?.hidden_reasons.find((r) => r.venue_id === group.venue_id)?.reason ?? null;
      if (reason) hides.push({ service_id: serviceId, name: service.name, reason });
      else shows.push({ service_id: serviceId, name: service.name });
    }
    return {
      venue_id: group.venue_id,
      venue_name: group.venue_name,
      is_host: group.is_host,
      shows: shows.sort((a, b) => a.name.localeCompare(b.name)),
      hides: hides.sort((a, b) => a.name.localeCompare(b.name)),
    };
  });

  return { venues };
}

/** The reason in the host's words, for `ov.preview.willHide`. */
export const PREVIEW_REASON_WORDS: Record<PreviewReason, string> = {
  no_calendars: 'no calendar there offers it',
  payments: 'card payments are not set up there',
  forms: 'forms are switched off there',
  suspended: "that venue's subscription has lapsed",
  staff_only: 'it is staff bookings only',
  behind: 'that venue is still updating',
};
