import { describe, it, expect } from 'vitest';
import { buildAddonSnapshots, totalsFromSnapshots } from './snapshot-addons';
import type { Addon, AddonGroup } from '@/types/booking-models';

const group: AddonGroup = {
  id: 'g-1',
  venue_id: 'v-1',
  name: 'Conditioner',
  prompt_to_client: null,
  description: null,
  selection_type: 'single',
  min_select: 1,
  max_select: 1,
  hidden_from_online: false,
  is_active: true,
  sort_order: 0,
  created_at: '',
  updated_at: '',
};

const a1: Addon = {
  id: 'a-1',
  addon_group_id: 'g-1',
  venue_id: 'v-1',
  name: 'Argan',
  description: null,
  additional_price_pence: 500,
  additional_duration_minutes: 5,
  cost_to_business_pence: 200,
  is_active: true,
  sort_order: 0,
  archived_at: null,
  created_at: '',
  updated_at: '',
};

const a2: Addon = { ...a1, id: 'a-2', name: 'Coconut', additional_price_pence: 800, additional_duration_minutes: 10 };

describe('buildAddonSnapshots', () => {
  it('produces one snapshot per selected addon', () => {
    const snaps = buildAddonSnapshots({
      selected: [a1, a2],
      groupsById: new Map([[group.id, group]]),
      bookingId: 'b-1',
    });
    expect(snaps).toHaveLength(2);
    expect(snaps[0]).toMatchObject({
      booking_id: 'b-1',
      addon_id: 'a-1',
      addon_group_id: 'g-1',
      addon_name_snapshot: 'Argan',
      addon_group_name_snapshot: 'Conditioner',
      price_pence_at_booking: 500,
      duration_minutes_at_booking: 5,
      cost_to_business_pence_at_booking: 200,
      booking_segment_index: null,
    });
    expect(snaps[1].addon_id).toBe('a-2');
  });

  it('plumbs segment_index when provided', () => {
    const snaps = buildAddonSnapshots({
      selected: [a1],
      groupsById: new Map([[group.id, group]]),
      bookingId: 'b-1',
      segmentIndex: 2,
    });
    expect(snaps[0].booking_segment_index).toBe(2);
  });

  it('omits booking_id when not provided', () => {
    const snaps = buildAddonSnapshots({
      selected: [a1],
      groupsById: new Map(),
    });
    expect(snaps[0].booking_id).toBeUndefined();
    expect(snaps[0].addon_group_name_snapshot).toBeNull();
  });
});

describe('totalsFromSnapshots', () => {
  it('sums price and duration', () => {
    const snaps = buildAddonSnapshots({
      selected: [a1, a2],
      groupsById: new Map([[group.id, group]]),
      bookingId: 'b-1',
    });
    const totals = totalsFromSnapshots(snaps);
    expect(totals.total_price_pence).toBe(1300);
    expect(totals.total_duration_minutes).toBe(15);
  });

  it('returns zero on empty array', () => {
    expect(totalsFromSnapshots([])).toEqual({ total_price_pence: 0, total_duration_minutes: 0 });
  });
});
