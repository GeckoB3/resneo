import { describe, expect, it } from 'vitest';
import {
  isMissingSyncColumnError,
  patchTouchesSyncedShape,
  planVariantSync,
  serviceShapeOf,
  shapesMatch,
} from './service-sync';

// The parser insists on uuid ids, so a block without one is dropped as invalid.
const blocks = (...b: Array<[number, number]>) =>
  b.map(([start_minute, duration_minutes], i) => ({ id: `00000000-0000-4000-8000-00000000000${i}`, start_minute, duration_minutes }));

describe('serviceShapeOf / shapesMatch', () => {
  it('compares the synced fields only, canonical shape applied, and ignores price and description', () => {
    const origin = { duration_minutes: 60, buffer_minutes: 5, processing_time_blocks: blocks([60, 60]), price_pence: 5000, description: 'a' };
    // Old shape of the same thing: 120 minutes with the block reaching the end.
    const copy = { duration_minutes: 120, buffer_minutes: 5, processing_time_blocks: blocks([60, 60]), price_pence: 8000, description: 'b' };
    expect(shapesMatch(serviceShapeOf(origin, []), serviceShapeOf(copy, []))).toBe(true);
    expect(shapesMatch(serviceShapeOf(origin, []), serviceShapeOf({ ...copy, buffer_minutes: 10 }, []))).toBe(false);
  });

  it('compares active variants by name, in any order, and ignores their prices', () => {
    const a = [
      { name: 'Short', duration_minutes: 30, buffer_minutes: 0, processing_time_blocks: [], price_pence: 1, is_active: true },
      { name: 'Long', duration_minutes: 90, buffer_minutes: 0, processing_time_blocks: blocks([30, 30]), price_pence: 2, is_active: true },
    ];
    const b = [
      { name: 'long ', duration_minutes: 90, buffer_minutes: 0, processing_time_blocks: blocks([30, 30]), price_pence: 99, is_active: true },
      { name: 'Short', duration_minutes: 30, buffer_minutes: 0, processing_time_blocks: [], price_pence: 98, is_active: true },
      { name: 'Retired', duration_minutes: 10, buffer_minutes: 0, processing_time_blocks: [], is_active: false },
    ];
    const base = { duration_minutes: 60, buffer_minutes: 0, processing_time_blocks: [] };
    expect(shapesMatch(serviceShapeOf(base, a), serviceShapeOf(base, b))).toBe(true);
    expect(shapesMatch(serviceShapeOf(base, a), serviceShapeOf(base, b.slice(1)))).toBe(false);
  });
});

describe('patchTouchesSyncedShape', () => {
  const current = { duration_minutes: 60, buffer_minutes: 0, processing_time_blocks: blocks([60, 30]) };

  it('is false for price, description and an unchanged shape', () => {
        expect(patchTouchesSyncedShape({ price_pence: 1000, description: 'x' }, null, current)).toBe(false);
    expect(patchTouchesSyncedShape({ duration_minutes: 60, processing_time_blocks: blocks([60, 30]) }, null, current)).toBe(false);
  });

  it('is false when the variants are sent again unchanged (the form always sends them), price included', () => {
    const stored = [{ name: 'Long', duration_minutes: 90, buffer_minutes: 5, processing_time_blocks: blocks([30, 30]), price_pence: 2000, is_active: true }];
    const resent = [{ name: 'long', duration_minutes: 90, buffer_minutes: 5, processing_time_blocks: blocks([30, 30]), price_pence: 2500 }];
    expect(patchTouchesSyncedShape({ price_pence: 1000 }, { next: resent, current: stored }, current)).toBe(false);
    expect(patchTouchesSyncedShape({}, { next: [], current: [] }, current)).toBe(false);
  });

  it('is true for a changed duration, buffer or processing, and when the variants change shape', () => {
    expect(patchTouchesSyncedShape({ duration_minutes: 45 }, null, current)).toBe(true);
    expect(patchTouchesSyncedShape({ buffer_minutes: 10 }, null, current)).toBe(true);
    expect(patchTouchesSyncedShape({ processing_time_blocks: blocks([60, 45]) }, null, current)).toBe(true);
    const stored = [{ name: 'Long', duration_minutes: 90, buffer_minutes: 5, processing_time_blocks: [], is_active: true }];
    expect(patchTouchesSyncedShape({}, { next: [{ ...stored[0], duration_minutes: 60 }], current: stored }, current)).toBe(true);
    expect(patchTouchesSyncedShape({}, { next: [], current: stored }, current)).toBe(true);
    expect(patchTouchesSyncedShape({}, { next: stored, current: [] }, current)).toBe(true);
  });
});

describe('planVariantSync', () => {
  const origin = [
    { id: 'o1', name: 'Short', duration_minutes: 30, buffer_minutes: 0, processing_time_blocks: [], price_pence: 1000, sort_order: 0, is_active: true, venue_id: 'vA', service_item_id: 'sA' },
    { id: 'o2', name: 'Long', duration_minutes: 90, buffer_minutes: 5, processing_time_blocks: blocks([30, 30]), price_pence: 2000, sort_order: 1, is_active: true, venue_id: 'vA', service_item_id: 'sA' },
    { id: 'o3', name: 'Gone', duration_minutes: 10, buffer_minutes: 0, processing_time_blocks: [], is_active: false, venue_id: 'vA', service_item_id: 'sA' },
  ];
  const copy = [
    { id: 'c1', name: 'short', duration_minutes: 45, buffer_minutes: 0, processing_time_blocks: [], price_pence: 1500, sort_order: 3, is_active: true },
    { id: 'c9', name: 'Extra', duration_minutes: 20, buffer_minutes: 0, processing_time_blocks: [], price_pence: 900, is_active: true },
  ];

  it('updates matched variants without touching their price, inserts new ones with the origin price, and deactivates the rest', () => {
    const plan = planVariantSync(origin, copy);
    expect(plan.update).toHaveLength(1);
    expect(plan.update[0]!.id).toBe('c1');
    expect(plan.update[0]!.fields).toMatchObject({ duration_minutes: 30, buffer_minutes: 0, sort_order: 0, is_active: true });
    // Written blocks keep the origin's uuid ids, so the parser accepts them downstream.
    const longUpdate = planVariantSync(origin, [{ id: 'c2', name: 'Long', duration_minutes: 90, buffer_minutes: 5, processing_time_blocks: [], is_active: true }]);
    expect((longUpdate.update[0]!.fields.processing_time_blocks as Array<{ id: string }>)[0]!.id).toMatch(/^[0-9a-f-]{36}$/);
    expect('price_pence' in plan.update[0]!.fields).toBe(false);
    expect('name' in plan.update[0]!.fields).toBe(false);

    expect(plan.insert).toHaveLength(1);
    expect(plan.insert[0]).toMatchObject({ name: 'Long', duration_minutes: 90, buffer_minutes: 5, price_pence: 2000, is_active: true });
    expect('id' in plan.insert[0]!).toBe(false);
    expect('venue_id' in plan.insert[0]!).toBe(false);
    expect('service_item_id' in plan.insert[0]!).toBe(false);

    expect(plan.deactivate).toEqual(['c9']);
  });

  it('does not push an inactive origin variant', () => {
    const plan = planVariantSync(origin, [{ id: 'c3', name: 'Gone', duration_minutes: 10, buffer_minutes: 0, processing_time_blocks: [], is_active: true }]);
    expect(plan.insert.map((r) => r.name)).not.toContain('Gone');
    expect(plan.deactivate).toEqual(['c3']);
  });
});

describe('isMissingSyncColumnError', () => {
  it('recognises the two ways a database without the migration says no', () => {
    expect(isMissingSyncColumnError({ code: '42703', message: 'column service_items.sync_state does not exist' })).toBe(true);
    expect(isMissingSyncColumnError({ code: 'PGRST204', message: "Could not find the 'synced_from_service_id' column" })).toBe(true);
    expect(isMissingSyncColumnError({ code: '23505', message: 'duplicate key' })).toBe(false);
    expect(isMissingSyncColumnError(null)).toBe(false);
  });
});
