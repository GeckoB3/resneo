import { describe, expect, it } from 'vitest';
import {
  labelUncategorisedOfferings,
  mergeMemberOwnServices,
  type CollectiveCatalogPractitioner,
  type MemberOwnCatalogue,
} from './collective-venue';

const HOST = 'venue-host';
const PARTNER = 'venue-partner';

function ownService(id: string, name: string, sortOrder = 0) {
  return {
    id,
    name,
    description: null,
    duration_minutes: 30,
    buffer_minutes: 5,
    price_pence: 2500,
    deposit_pence: null,
    payment_requirement: 'none' as const,
    sort_order: sortOrder,
    category: { id: 'cat-own', name: 'Hair', sort_order: 0 },
    cancellation_notice_hours: 24,
    variants: [],
    addon_groups: [],
    processing_time_blocks: [],
    location_type: 'client_address' as const,
  };
}

/** A merged catalogue already holding the combined offerings, keyed by calendar. */
function offeringsOnly() {
  const byCalendar = new Map<string, CollectiveCatalogPractitioner>();
  const ensure = (calendarId: string, name: string, venueId: string): CollectiveCatalogPractitioner => {
    let entry = byCalendar.get(calendarId);
    if (!entry) {
      entry = { id: calendarId, name, owning_venue_id: venueId, owning_venue_name: '', services: [] };
      byCalendar.set(calendarId, entry);
    }
    return entry;
  };
  const andrew = ensure('cal-andrew', 'Andrew', HOST);
  andrew.services.push({
    id: 'offering-haircut',
    name: 'Haircut',
    description: null,
    duration_minutes: 30,
    buffer_minutes: 0,
    price_pence: 2500,
    deposit_pence: null,
    payment_requirement: 'none',
    sort_order: 0,
    category: { id: 'cat-styling', name: 'Styling', sort_order: 0 },
    cancellation_notice_hours: 24,
    variants: [],
    addon_groups: [],
    any_available: true,
    source_service_id: 'src-haircut',
  });
  return { byCalendar, ensure };
}

describe('mergeMemberOwnServices', () => {
  it('adds each member venue\'s own services after the offerings under a "{Venue} only" heading', () => {
    const { byCalendar, ensure } = offeringsOnly();
    const members: MemberOwnCatalogue[] = [
      {
        venueId: HOST,
        name: 'Test Plus',
        anyAvailable: true,
        catalog: {
          practitioners: [
            // The offered source service is not listed twice; the other own service is.
            { id: 'cal-andrew', name: 'Andrew', services: [ownService('src-haircut', 'Haircut'), ownService('src-blow-dry', 'Blow Dry', 3)] },
            // A calendar with no combined offering appears with its own services.
            { id: 'cal-staff-1', name: 'Staff 1', services: [ownService('src-blow-dry', 'Blow Dry', 3)] },
          ],
        },
      },
      {
        venueId: PARTNER,
        name: 'Light 3',
        anyAvailable: false,
        catalog: { practitioners: [{ id: 'cal-light', name: 'Light 3', services: [ownService('src-massage', 'Massage')] }] },
      },
    ];

    const headings = mergeMemberOwnServices({ members, ensure, offeringCount: 1 });

    expect(headings.map((h) => h.name)).toEqual(['Test Plus only', 'Light 3 only']);
    expect(headings[0]!.sort_order).toBeLessThan(headings[1]!.sort_order);

    const andrew = byCalendar.get('cal-andrew')!;
    expect(andrew.services.map((s) => s.id)).toEqual(['offering-haircut', 'src-blow-dry']);
    const blowDry = andrew.services[1]!;
    expect(blowDry).toMatchObject({
      venue_only: true,
      source_service_id: 'src-blow-dry',
      category: { id: `venue-only:${HOST}`, name: 'Test Plus only' },
      any_available: true,
      location_type: 'client_address',
    });
    // Sorted after every offering (offering positions start at 0).
    expect(blowDry.sort_order).toBe(1 + 3);

    expect(byCalendar.get('cal-staff-1')!.owning_venue_id).toBe(HOST);
    expect(byCalendar.get('cal-light')!.services[0]).toMatchObject({ venue_only: true, any_available: false });
  });

  it('lists the combined offerings before every venue-only group, uncategorised ones under the collective name', () => {
    const { byCalendar, ensure } = offeringsOnly();
    const andrew = byCalendar.get('cal-andrew')!;
    // The host left this offering without a heading.
    andrew.services.push({ ...andrew.services[0]!, id: 'offering-tint', source_service_id: 'src-tint', category: null });
    const heading = { id: 'collective:col-1', name: 'Plus 1 Staging', sort_order: 99_999 };

    expect(labelUncategorisedOfferings([...byCalendar.values()], heading)).toBe(true);
    const [ownOnly] = mergeMemberOwnServices({
      members: [{ venueId: HOST, name: 'Test Plus', anyAvailable: true, catalog: { practitioners: [{ id: 'cal-andrew', name: 'Andrew', services: [ownService('src-blow-dry', 'Blow Dry')] }] } }],
      ensure,
      offeringCount: 2,
    });

    expect(andrew.services.map((s) => s.category?.name)).toEqual(['Styling', 'Plus 1 Staging', 'Test Plus only']);
    // The categorised offering keeps its own heading; the venue-only group sorts last.
    expect(andrew.services[0]!.category!.sort_order).toBeLessThan(heading.sort_order);
    expect(heading.sort_order).toBeLessThan(ownOnly!.sort_order);
    // Nothing left to label second time round, and own services are never relabelled.
    expect(labelUncategorisedOfferings([...byCalendar.values()], heading)).toBe(false);
    expect(andrew.services[2]!.category!.name).toBe('Test Plus only');
  });

  it('uses no heading for a member whose services are all already offered', () => {
    const { byCalendar, ensure } = offeringsOnly();
    const headings = mergeMemberOwnServices({
      members: [
        { venueId: HOST, name: 'Test Plus', anyAvailable: true, catalog: { practitioners: [{ id: 'cal-andrew', name: 'Andrew', services: [ownService('src-haircut', 'Haircut')] }] } },
      ],
      ensure,
      offeringCount: 1,
    });
    expect(headings).toEqual([]);
    expect(byCalendar.get('cal-andrew')!.services).toHaveLength(1);
  });
});
