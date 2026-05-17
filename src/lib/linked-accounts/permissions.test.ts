import { describe, expect, it } from 'vitest';
import {
  grantsToColumns,
  isGrantCoherent,
  isLinkConfigurationValid,
  isReductionOnly,
  normaliseGrant,
  orderVenuePair,
  viewLinkForVenue,
} from './permissions';
import type { AccountLinkRow, LinkGrant } from './types';

describe('normaliseGrant — §5.5 coherence rules', () => {
  it('time_only forces pii=false and act=none', () => {
    expect(normaliseGrant({ calendar: 'time_only', pii: true, act: 'create_edit_cancel' })).toEqual(
      { calendar: 'time_only', pii: false, act: 'none' },
    );
  });

  it('none forces pii=false and act=none', () => {
    expect(normaliseGrant({ calendar: 'none', pii: true, act: 'edit_existing' })).toEqual({
      calendar: 'none',
      pii: false,
      act: 'none',
    });
  });

  it('pii=false forces act=none even with full_details', () => {
    expect(
      normaliseGrant({ calendar: 'full_details', pii: false, act: 'create_edit_cancel' }),
    ).toEqual({ calendar: 'full_details', pii: false, act: 'none' });
  });

  it('full_details + pii=true keeps the action level', () => {
    const g: LinkGrant = { calendar: 'full_details', pii: true, act: 'edit_existing' };
    expect(normaliseGrant(g)).toEqual(g);
  });
});

describe('isGrantCoherent', () => {
  it('flags an incoherent grant', () => {
    expect(isGrantCoherent({ calendar: 'time_only', pii: true, act: 'none' })).toBe(false);
  });
  it('accepts a coherent grant', () => {
    expect(isGrantCoherent({ calendar: 'full_details', pii: true, act: 'edit_existing' })).toBe(
      true,
    );
  });
});

describe('isLinkConfigurationValid — no zero-way links', () => {
  const none: LinkGrant = { calendar: 'none', pii: false, act: 'none' };
  const some: LinkGrant = { calendar: 'time_only', pii: false, act: 'none' };

  it('rejects none in both directions', () => {
    expect(isLinkConfigurationValid(none, none)).toBe(false);
  });
  it('allows a one-way link', () => {
    expect(isLinkConfigurationValid(some, none)).toBe(true);
    expect(isLinkConfigurationValid(none, some)).toBe(true);
  });
});

describe('isReductionOnly', () => {
  const full: LinkGrant = { calendar: 'full_details', pii: true, act: 'create_edit_cancel' };

  it('treats an equal grant as a reduction (no-op)', () => {
    expect(isReductionOnly(full, full)).toBe(true);
  });
  it('accepts a strict reduction', () => {
    expect(isReductionOnly(full, { calendar: 'time_only', pii: false, act: 'none' })).toBe(true);
  });
  it('rejects an increase in calendar visibility', () => {
    const low: LinkGrant = { calendar: 'time_only', pii: false, act: 'none' };
    expect(isReductionOnly(low, full)).toBe(false);
  });
  it('rejects an increase in action level', () => {
    const editOnly: LinkGrant = { calendar: 'full_details', pii: true, act: 'edit_existing' };
    expect(isReductionOnly(editOnly, full)).toBe(false);
  });
});

describe('orderVenuePair', () => {
  it('always returns the smaller id as low', () => {
    expect(orderVenuePair('b', 'a')).toEqual({ low: 'a', high: 'b' });
    expect(orderVenuePair('a', 'b')).toEqual({ low: 'a', high: 'b' });
  });
});

describe('grantsToColumns', () => {
  it('maps low/high authored grants onto columns and normalises them', () => {
    const cols = grantsToColumns({
      venueLowId: 'a',
      venueHighId: 'b',
      lowGrants: { calendar: 'time_only', pii: true, act: 'edit_existing' },
      highGrants: { calendar: 'full_details', pii: true, act: 'create_edit_cancel' },
    });
    // low grant gets normalised down (time_only → pii false, act none)
    expect(cols.low_grants_calendar).toBe('time_only');
    expect(cols.low_grants_pii).toBe(false);
    expect(cols.low_grants_act).toBe('none');
    expect(cols.high_grants_calendar).toBe('full_details');
    expect(cols.high_grants_act).toBe('create_edit_cancel');
  });
});

describe('viewLinkForVenue — perspective resolution', () => {
  const baseRow: AccountLinkRow = {
    id: 'link1',
    venue_low_id: 'a',
    venue_high_id: 'b',
    requested_by_venue_id: 'a',
    status: 'accepted',
    low_grants_calendar: 'full_details',
    low_grants_pii: true,
    low_grants_act: 'edit_existing',
    high_grants_calendar: 'time_only',
    high_grants_pii: false,
    high_grants_act: 'none',
    request_message: null,
    pending_change: null,
    created_by_user_id: null,
    responded_by_user_id: null,
    created_at: '2026-05-01T00:00:00Z',
    responded_at: '2026-05-02T00:00:00Z',
    terminated_at: null,
    termination_reason: null,
    updated_at: '2026-05-02T00:00:00Z',
  };
  const lookup = { a: { name: 'Venue A', slug: 'a' }, b: { name: 'Venue B', slug: 'b' } };

  it('frames grants from the low venue perspective', () => {
    const v = viewLinkForVenue(baseRow, 'a', lookup);
    expect(v).not.toBeNull();
    // low_grants is what venue A exposes to B → "they (B) can"
    expect(v!.theyCan.calendar).toBe('full_details');
    // high_grants is what B exposes to A → "I (A) can"
    expect(v!.iCan.calendar).toBe('time_only');
    expect(v!.initiatedByMe).toBe(true);
    expect(v!.otherVenue.id).toBe('b');
  });

  it('frames grants from the high venue perspective', () => {
    const v = viewLinkForVenue(baseRow, 'b', lookup);
    expect(v!.theyCan.calendar).toBe('time_only');
    expect(v!.iCan.calendar).toBe('full_details');
    expect(v!.initiatedByMe).toBe(false);
    expect(v!.otherVenue.id).toBe('a');
  });

  it('returns null when the venue is not a member', () => {
    expect(viewLinkForVenue(baseRow, 'c', lookup)).toBeNull();
  });
});
