import { describe, expect, it } from 'vitest';
import type { VenueCatalogueData } from '@/lib/linked-accounts/catalogue';
import { buildDerivedCatalogueItems, type DerivedCatalogueInput, type DerivedVenue } from './derived-catalogue';

const heading = { id: 'h-skin', name: 'Skin', sort_order: 1 };

function venueData(
  services: { id: string; name: string; price: number; calendars: { id: string; name: string; price?: number; minutes?: number }[] }[],
): VenueCatalogueData {
  const data: VenueCatalogueData = {
    services: new Map(),
    calendars: new Map(),
    serviceCalendars: new Map(),
    calendarServiceTerms: new Map(),
    serviceList: [],
    calendarList: [],
  };
  for (const s of services) {
    data.services.set(s.id, { name: s.name, durationMinutes: 30, pricePence: s.price, description: `${s.name} desc`, sortOrder: 3, category: heading });
    data.serviceCalendars.set(s.id, s.calendars.map((c) => c.id));
    for (const c of s.calendars) {
      data.calendars.set(c.id, { name: c.name });
      data.calendarServiceTerms.set(`${c.id}:${s.id}`, {
        durationMinutes: c.minutes ?? 30, pricePence: c.price ?? s.price, bufferMinutes: 0, depositPence: null, processingBlocks: [],
      });
    }
  }
  return data;
}

const venue = (over: Partial<DerivedVenue> = {}): DerivedVenue => ({
  name: 'V', slug: 'v', eligible: true, suspended: false, chargesEnabled: true, formsOn: true, ...over,
});

function input(over: Partial<DerivedCatalogueInput> = {}): DerivedCatalogueInput {
  return {
    hostVenueId: 'host',
    offerings: [{ id: 'item-1', masterServiceId: 'm1', displayOrder: 0, imageUrl: null, pricingDisplay: 'from', allowAnyAvailable: true }],
    links: [{ itemId: 'item-1', venueId: 'member', replicaServiceId: 'r1', current: true }],
    venues: { host: venue({ name: 'Host', slug: 'host' }), member: venue({ name: 'Member', slug: 'member' }) },
    venueData: {
      host: venueData([{ id: 'm1', name: 'Peel', price: 5000, calendars: [{ id: 'hc1', name: 'Host room' }] }]),
      member: venueData([{ id: 'r1', name: 'Peel', price: 5000, calendars: [{ id: 'mc1', name: 'Ann', price: 4500, minutes: 40 }, { id: 'mc2', name: 'Bea' }] }]),
    },
    paidServiceIds: new Set(),
    serviceIdsWithForms: new Set(),
    venueIdsWithVenueWideForms: new Set(),
    staffOnlyServiceIds: new Set(),
    ...over,
  };
}

describe('buildDerivedCatalogueItems', () => {
  it("lists the host master and each converged replica, one provider per assigned calendar, at that calendar's terms", () => {
    const [item] = buildDerivedCatalogueItems(input());
    expect(item!.name).toBe('Peel');
    expect(item!.description).toBe('Peel desc');
    expect(item!.category).toEqual(heading);
    expect(item!.providers.map((p) => [p.venueId, p.practitionerId, p.sourceServiceId, p.pricePence, p.durationMinutes])).toEqual([
      ['host', 'hc1', 'm1', 5000, 30],
      ['member', 'mc1', 'r1', 4500, 40],
      ['member', 'mc2', 'r1', 5000, 30],
    ]);
    expect(item!.fromPricePence).toBe(4500);
    expect(item!.excluded).toEqual([]);
  });

  it('takes the name and heading from the master when the host offers it on no calendar of its own', () => {
    /*
      The 19 Sep "Beard Trim" case: the host filed the master under Hair but had not put it on
      any of its calendars, so it was missing from the host's calendar-built data. The offering
      then took its name from the member's replica and had no heading at all, so the combined
      page listed it under "Other services" while every host-offered service sat under its heading.
    */
    const hair = { id: 'h-hair', name: 'Hair', sort_order: 0 };
    const [item] = buildDerivedCatalogueItems(
      input({
        venueData: {
          host: venueData([]),
          member: venueData([{ id: 'r1', name: 'Beard trim (copy)', price: 1800, calendars: [{ id: 'mc1', name: 'Ann' }] }]),
        },
        masters: { m1: { name: 'Beard Trim', description: 'Tidy and shape', category: hair, sortOrder: 7 } },
      }),
    );
    expect(item!.name).toBe('Beard Trim');
    expect(item!.description).toBe('Tidy and shape');
    expect(item!.category).toEqual(hair);
    expect(item!.sortKey).toEqual({ displayOrder: 0, sourceOrder: 7, category: hair });
    // Only the member offers it; the host contributes the words, not a provider.
    expect(item!.providers.map((p) => [p.venueId, p.practitionerId])).toEqual([['member', 'mc1']]);
  });

  it('still prefers what the host calendar data says when the master is on a host calendar', () => {
    const [item] = buildDerivedCatalogueItems(
      input({ masters: { m1: { name: 'Stale name', description: null, category: null, sortOrder: 1 } } }),
    );
    expect(item!.name).toBe('Peel');
    expect(item!.category).toEqual(heading);
  });

  it('leaves out a replica that is behind, and says why', () => {
    const [item] = buildDerivedCatalogueItems(input({ links: [{ itemId: 'item-1', venueId: 'member', replicaServiceId: 'r1', current: false }] }));
    expect(item!.providers.map((p) => p.venueId)).toEqual(['host']);
    expect(item!.excluded.map((e) => [e.provider.practitionerId, e.reason])).toEqual([['mc1', 'behind'], ['mc2', 'behind']]);
  });

  it('leaves out a suspended member', () => {
    const [item] = buildDerivedCatalogueItems(input({ venues: { host: venue(), member: venue({ suspended: true }) } }));
    expect(new Set(item!.excluded.map((e) => e.reason))).toEqual(new Set(['suspended']));
  });

  it('leaves out a paid service at a venue that cannot take card payments', () => {
    const [item] = buildDerivedCatalogueItems(input({
      paidServiceIds: new Set(['r1', 'm1']),
      venues: { host: venue(), member: venue({ chargesEnabled: false }) },
    }));
    expect(item!.providers.map((p) => p.venueId)).toEqual(['host']);
    expect(item!.excluded.every((e) => e.reason === 'payments')).toBe(true);
  });

  it('leaves out a form-bearing service at a venue with forms off, including venue-wide forms', () => {
    const own = buildDerivedCatalogueItems(input({
      serviceIdsWithForms: new Set(['r1']), venues: { host: venue(), member: venue({ formsOn: false }) },
    }))[0]!;
    expect(own.excluded.every((e) => e.reason === 'forms')).toBe(true);
    const venueWide = buildDerivedCatalogueItems(input({
      venueIdsWithVenueWideForms: new Set(['member']), venues: { host: venue(), member: venue({ formsOn: false }) },
    }))[0]!;
    expect(venueWide.providers.map((p) => p.venueId)).toEqual(['host']);
  });

  it('keeps a staff-only service for staff and hides it from guests', () => {
    const [item] = buildDerivedCatalogueItems(input({ staffOnlyServiceIds: new Set(['r1']) }));
    expect(item!.providers.map((p) => p.venueId)).toEqual(['host']);
    expect(item!.excluded.every((e) => e.reason === 'staff_only')).toBe(true);
  });

  it('ignores an offering with nothing to show, an ineligible venue, and a link with no replica yet', () => {
    expect(buildDerivedCatalogueItems(input({
      venues: { host: venue({ eligible: false }), member: venue({ eligible: false }) },
    }))).toEqual([]);
    const [item] = buildDerivedCatalogueItems(input({ links: [{ itemId: 'item-1', venueId: 'member', replicaServiceId: null, current: false }] }));
    expect(item!.providers.map((p) => p.venueId)).toEqual(['host']);
    expect(item!.excluded).toEqual([]);
  });
});
