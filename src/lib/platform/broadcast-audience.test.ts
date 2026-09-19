import { describe, expect, it } from 'vitest';
import {
  buildAudienceVenues,
  buildBroadcastRecipients,
  classifyAudienceSegment,
  parseAudienceSelection,
  selectAudienceVenues,
  type AudienceStaffRow,
  type AudienceVenueRow,
} from './broadcast-audience';

const NOW = Date.parse('2026-09-19T12:00:00Z');
const FUTURE = '2026-10-19T12:00:00Z';
const PAST = '2026-09-01T12:00:00Z';

function venue(id: string, overrides: Partial<AudienceVenueRow> = {}): AudienceVenueRow {
  return {
    id,
    name: `Venue ${id}`,
    slug: id,
    email: `hello@${id}.test`,
    pricing_tier: 'plus',
    plan_status: 'active',
    billing_access_source: 'stripe',
    subscription_current_period_end: FUTURE,
    is_test: false,
    ...overrides,
  };
}

describe('classifyAudienceSegment', () => {
  it('sorts current subscribers into segments', () => {
    expect(classifyAudienceSegment(venue('a'), NOW)).toBe('paying');
    expect(classifyAudienceSegment(venue('a', { plan_status: 'trialing' }), NOW)).toBe('trial');
    expect(classifyAudienceSegment(venue('a', { plan_status: 'cancelling' }), NOW)).toBe('cancelling');
    expect(classifyAudienceSegment(venue('a', { plan_status: 'past_due' }), NOW)).toBe('past_due');
    expect(classifyAudienceSegment(venue('a', { billing_access_source: 'superuser_free', plan_status: 'cancelled' }), NOW)).toBe(
      'complimentary',
    );
    expect(classifyAudienceSegment(venue('a', { is_test: true }), NOW)).toBe('test');
  });

  it('keeps a cancelled venue while its paid period runs, and drops it after', () => {
    expect(classifyAudienceSegment(venue('a', { plan_status: 'cancelled', subscription_current_period_end: FUTURE }), NOW)).toBe(
      'cancelling',
    );
    expect(classifyAudienceSegment(venue('a', { plan_status: 'cancelled', subscription_current_period_end: PAST }), NOW)).toBeNull();
    // A 'cancelling' row stuck past its period end (missed webhook) has effectively ended.
    expect(classifyAudienceSegment(venue('a', { plan_status: 'cancelling', subscription_current_period_end: PAST }), NOW)).toBeNull();
  });
});

describe('buildAudienceVenues', () => {
  const staff: AudienceStaffRow[] = [
    { venue_id: 'a', name: 'Sam Owner', email: 'Sam@Owner.test' },
    { venue_id: 'a', name: 'Sam again', email: 'sam@owner.test' },
    { venue_id: 'b', name: 'Sam Owner', email: 'sam@owner.test' },
    { venue_id: 'b', name: 'Priya Manager', email: 'priya@b.test' },
    { venue_id: 'c', name: 'Broken', email: 'not-an-email' },
  ];

  it('uses admin logins, lower-cased and de-duplicated, and falls back to the business email', () => {
    const venues = buildAudienceVenues(
      [venue('a'), venue('b'), venue('c'), venue('d', { email: null })],
      staff,
      new Set(),
      NOW,
    );
    const byId = Object.fromEntries(venues.map((v) => [v.id, v]));
    expect(byId.a.contacts.map((c) => c.email)).toEqual(['sam@owner.test']);
    expect(byId.a.contactSource).toBe('admins');
    expect(byId.c.contacts.map((c) => c.email)).toEqual(['hello@c.test']);
    expect(byId.c.contactSource).toBe('business_email');
    expect(byId.d.contacts).toEqual([]);
    expect(byId.d.contactSource).toBe('none');
  });

  it('leaves out venues whose subscription has ended', () => {
    const venues = buildAudienceVenues(
      [venue('a'), venue('gone', { plan_status: 'cancelled', subscription_current_period_end: PAST })],
      [],
      new Set(),
      NOW,
    );
    expect(venues.map((v) => v.id)).toEqual(['a']);
  });

  it('marks opted-out addresses', () => {
    const venues = buildAudienceVenues([venue('b')], staff, new Set(['priya@b.test']), NOW);
    expect(venues[0].contacts.find((c) => c.email === 'priya@b.test')?.optedOut).toBe(true);
    expect(venues[0].contacts.find((c) => c.email === 'sam@owner.test')?.optedOut).toBe(false);
  });
});

describe('recipients', () => {
  const venues = buildAudienceVenues(
    [venue('a'), venue('b'), venue('t', { is_test: true })],
    [
      { venue_id: 'a', name: null, email: 'sam@owner.test' },
      { venue_id: 'b', name: 'Sam Owner', email: 'sam@owner.test' },
      { venue_id: 't', name: 'Tester', email: 'qa@resneo.test' },
    ],
    new Set(),
    NOW,
  );

  it('sends one email per person across the venues they run', () => {
    const recipients = buildBroadcastRecipients(selectAudienceVenues(venues, { mode: 'all' }));
    expect(recipients).toHaveLength(1);
    expect(recipients[0]).toMatchObject({
      email: 'sam@owner.test',
      firstName: 'Sam',
      venueIds: ['a', 'b'],
      venueNames: ['Venue a', 'Venue b'],
    });
  });

  it('leaves test venues out of "all" but lets them be picked by hand', () => {
    expect(selectAudienceVenues(venues, { mode: 'all' }).map((v) => v.id)).toEqual(['a', 'b']);
    expect(selectAudienceVenues(venues, { mode: 'selected', venueIds: ['t'] }).map((v) => v.id)).toEqual(['t']);
  });

  it('only accepts well-formed venue ids in a selection', () => {
    const sel = parseAudienceSelection({
      mode: 'selected',
      venue_ids: ['11111111-1111-4111-8111-111111111111', 'x', 7, '11111111-1111-4111-8111-111111111111'],
    });
    expect(sel).toEqual({ mode: 'selected', venueIds: ['11111111-1111-4111-8111-111111111111'] });
    expect(parseAudienceSelection(null)).toEqual({ mode: 'all' });
  });
});
