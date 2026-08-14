import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveCascadingVisitGroupId } from './group-booking-status-sync';

/**
 * `group_booking_id` links two different things, and cascading a status change
 * across the wrong one forfeited real money: marking one child in a family group
 * as a no-show flipped both parents to no-show and forfeited their paid deposits.
 */

function dbReturning(rows: Array<Record<string, unknown>>): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: async () => ({ data: rows, error: null }),
        }),
      }),
    }),
  } as unknown as SupabaseClient;
}

const visitRow = (id: string) => ({
  id,
  status: 'Booked',
  guest_id: 'g1',
  person_label: null,
});

const attendeeRow = (id: string, label: string) => ({
  id,
  status: 'Booked',
  guest_id: 'g1',
  person_label: label,
});

/**
 * A class-cart row: several sessions bought in one checkout. They share a group
 * id and carry NO person label, so before C12 they read as a multi-service visit
 * and a no-show on one session cascaded to the whole basket.
 */
const cartRow = (id: string, classInstanceId: string) => ({
  id,
  status: 'Booked',
  guest_id: 'g1',
  person_label: null,
  class_instance_id: classInstanceId,
});

describe('resolveCascadingVisitGroupId', () => {
  it('cascades across a multi-service visit (one guest, no person labels)', async () => {
    const db = dbReturning([visitRow('a'), visitRow('b'), visitRow('c')]);
    expect(await resolveCascadingVisitGroupId(db, 'v1', 'grp-1')).toBe('grp-1');
  });

  it('does NOT cascade across a group booking of distinct people', async () => {
    const db = dbReturning([
      attendeeRow('a', 'Mum'),
      attendeeRow('b', 'Dad'),
      attendeeRow('c', 'Child'),
    ]);
    expect(await resolveCascadingVisitGroupId(db, 'v1', 'grp-1')).toBeNull();
  });

  it('does not cascade when even one row carries a person label', async () => {
    const db = dbReturning([visitRow('a'), attendeeRow('b', 'Dad')]);
    expect(await resolveCascadingVisitGroupId(db, 'v1', 'grp-1')).toBeNull();
  });

  it('treats a blank person label as no label', async () => {
    const db = dbReturning([attendeeRow('a', '   '), attendeeRow('b', '')]);
    expect(await resolveCascadingVisitGroupId(db, 'v1', 'grp-1')).toBe('grp-1');
  });

  it('does NOT cascade across a class cart (C12)', async () => {
    // The rows look exactly like a visit on `person_label` alone. Cascading a
    // no-show here forfeited the deposits of every other session in the basket,
    // including sessions weeks in the future, since the sibling load applies no
    // status or date filter.
    const db = dbReturning([cartRow('a', 'ci-1'), cartRow('b', 'ci-2'), cartRow('c', 'ci-3')]);
    expect(await resolveCascadingVisitGroupId(db, 'v1', 'grp-1')).toBeNull();
  });

  it('does not cascade when even one row is a class row', async () => {
    const db = dbReturning([visitRow('a'), cartRow('b', 'ci-1')]);
    expect(await resolveCascadingVisitGroupId(db, 'v1', 'grp-1')).toBeNull();
  });

  it('still cascades a visit whose rows carry an explicit null class_instance_id', async () => {
    // The discriminator must key on a REAL class link, not on the column merely
    // being present in the projection.
    const db = dbReturning([
      { ...visitRow('a'), class_instance_id: null },
      { ...visitRow('b'), class_instance_id: null },
    ]);
    expect(await resolveCascadingVisitGroupId(db, 'v1', 'grp-1')).toBe('grp-1');
  });

  it('has nothing to cascade for a lone row', async () => {
    const db = dbReturning([visitRow('a')]);
    expect(await resolveCascadingVisitGroupId(db, 'v1', 'grp-1')).toBeNull();
  });

  it('returns null without querying when the booking has no group id', async () => {
    const from = vi.fn();
    const db = { from } as unknown as SupabaseClient;
    expect(await resolveCascadingVisitGroupId(db, 'v1', null)).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });
});
