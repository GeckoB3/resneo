import { describe, expect, it } from 'vitest';
import {
  applyCalendarVisibilityChange,
  calendarIdsEqual,
  describeGrant,
  diffGrant,
  grantsToColumns,
  isGrantCoherent,
  isIncreaseOnly,
  isLinkConfigurationValid,
  isReductionOnly,
  grantsEqual,
  normaliseCalendarIds,
  normaliseGrant,
  orderVenuePair,
  viewLinkForVenue,
} from './permissions';
import type { AccountLinkRow, LinkGrant } from './types';

describe('diffGrant', () => {
  const full: LinkGrant = { calendar: 'full_details', pii: true, act: 'edit_existing' };

  it('returns no bullets when the grants are equivalent', () => {
    expect(diffGrant(full, { ...full })).toEqual([]);
  });

  it('reports a PII change in isolation', () => {
    const before: LinkGrant = { calendar: 'full_details', pii: true, act: 'none' };
    const after: LinkGrant = { calendar: 'full_details', pii: false, act: 'none' };
    expect(diffGrant(before, after)).toEqual(['Client details: shared → hidden']);
  });

  it('also reports the implied action loss when PII is turned off', () => {
    // Turning PII off clamps act to none (§5.5), so the diff surfaces both.
    expect(diffGrant(full, { ...full, pii: false })).toEqual([
      'Client details: shared → hidden',
      'Booking actions: edit existing bookings → view only',
    ]);
  });

  it('reports an action-level change', () => {
    const bullets = diffGrant(full, { calendar: 'full_details', pii: true, act: 'create_edit_cancel' });
    expect(bullets).toEqual(['Booking actions: edit existing bookings → full booking management']);
  });

  it('reports a calendar change and suppresses implied pii/act noise', () => {
    const bullets = diffGrant(full, { calendar: 'time_only', pii: false, act: 'none' });
    expect(bullets).toEqual(['Calendar visibility: full calendar detail → time blocks only']);
  });
});

describe('normaliseGrant — §5.5 coherence rules', () => {
  it('time_only forces pii=false and act=none', () => {
    expect(normaliseGrant({ calendar: 'time_only', pii: true, act: 'create_edit_cancel' })).toEqual(
      { calendar: 'time_only', pii: false, act: 'none', calendarIds: null },
    );
  });

  it('none forces pii=false and act=none', () => {
    expect(normaliseGrant({ calendar: 'none', pii: true, act: 'edit_existing' })).toEqual({
      calendar: 'none',
      pii: false,
      act: 'none',
      calendarIds: null,
    });
  });

  it('pii=false forces act=none even with full_details', () => {
    expect(
      normaliseGrant({ calendar: 'full_details', pii: false, act: 'create_edit_cancel' }),
    ).toEqual({ calendar: 'full_details', pii: false, act: 'none', calendarIds: null });
  });

  it('full_details + pii=true keeps the action level', () => {
    const g: LinkGrant = { calendar: 'full_details', pii: true, act: 'edit_existing' };
    expect(normaliseGrant(g)).toEqual({ ...g, calendarIds: null });
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

describe('isIncreaseOnly', () => {
  const timeOnly: LinkGrant = { calendar: 'time_only', pii: false, act: 'none' };
  const full: LinkGrant = { calendar: 'full_details', pii: true, act: 'create_edit_cancel' };

  it('accepts time_only → full_details + PII + create_edit_cancel', () => {
    expect(isIncreaseOnly(timeOnly, full)).toBe(true);
  });
  it('rejects equal grants', () => {
    expect(isIncreaseOnly(full, full)).toBe(false);
  });
  it('rejects a strict reduction', () => {
    expect(isIncreaseOnly(full, timeOnly)).toBe(false);
  });
});

describe('grantsEqual', () => {
  it('treats normalised equivalents as equal', () => {
    expect(
      grantsEqual(
        { calendar: 'time_only', pii: true, act: 'create_edit_cancel' },
        { calendar: 'time_only', pii: false, act: 'none' },
      ),
    ).toBe(true);
  });
});

describe('applyCalendarVisibilityChange', () => {
  it('enables PII and edit when upgrading from time_only', () => {
    expect(
      applyCalendarVisibilityChange(
        { calendar: 'time_only', pii: false, act: 'none' },
        'full_details',
      ),
    ).toEqual({ calendar: 'full_details', pii: true, act: 'edit_existing', calendarIds: null });
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
    low_grants_calendar_ids: null,
    high_grants_calendar: 'time_only',
    high_grants_pii: false,
    high_grants_act: 'none',
    high_grants_calendar_ids: null,
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

describe('§18 calendar scope', () => {
  const full = (calendarIds: string[] | null): LinkGrant => ({
    calendar: 'full_details',
    pii: true,
    act: 'edit_existing',
    calendarIds,
  });

  it('normaliseCalendarIds canonicalises empty → null and dedupes/sorts', () => {
    expect(normaliseCalendarIds(null)).toBeNull();
    expect(normaliseCalendarIds([])).toBeNull();
    expect(normaliseCalendarIds(['b', 'a', 'a'])).toEqual(['a', 'b']);
  });

  it('normaliseGrant clears scope when calendar is none, keeps it otherwise', () => {
    expect(normaliseGrant({ calendar: 'none', pii: true, act: 'none', calendarIds: ['x'] }).calendarIds).toBeNull();
    expect(normaliseGrant(full(['x'])).calendarIds).toEqual(['x']);
    expect(normaliseGrant({ calendar: 'time_only', pii: false, act: 'none', calendarIds: ['x'] }).calendarIds).toEqual(['x']);
  });

  it('calendarIdsEqual treats null (all) distinctly from a specific list', () => {
    expect(calendarIdsEqual(null, null)).toBe(true);
    expect(calendarIdsEqual(null, ['a'])).toBe(false);
    expect(calendarIdsEqual(['a', 'b'], ['a', 'b'])).toBe(true);
  });

  it('grantsEqual distinguishes scope', () => {
    expect(grantsEqual(full(null), full(['a']))).toBe(false);
    expect(grantsEqual(full(['a']), full(['a']))).toBe(true);
  });

  it('narrowing scope is a reduction; widening is an increase', () => {
    // all → subset: reduction (allowed unilaterally), not an increase
    expect(isReductionOnly(full(null), full(['a']))).toBe(true);
    expect(isIncreaseOnly(full(null), full(['a']))).toBe(false);
    // subset → all: increase, not a reduction
    expect(isReductionOnly(full(['a']), full(null))).toBe(false);
    expect(isIncreaseOnly(full(['a']), full(null))).toBe(true);
    // subset → smaller subset: reduction
    expect(isReductionOnly(full(['a', 'b']), full(['a']))).toBe(true);
    // subset → larger subset: increase
    expect(isIncreaseOnly(full(['a']), full(['a', 'b']))).toBe(true);
  });

  it('describeGrant notes the scope when limited', () => {
    expect(describeGrant(full(['a', 'b']))).toContain('only for 2 selected calendars');
    expect(describeGrant(full(['a']))).toContain('only for 1 selected calendar');
    expect(describeGrant(full(null))).not.toContain('only for');
  });
});
