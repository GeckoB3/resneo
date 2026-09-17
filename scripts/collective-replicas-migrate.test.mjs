/**
 * MIG-01 / MIG-02 (script half): the signed report hash, the argument rules and the fence.
 * The database half is supabase/tests/collective_migration_test.sql.
 */
import { describe, expect, it } from 'vitest';
import {
  PRODUCTION_REF,
  canonicalJson,
  fenceError,
  parseArgs,
  planBlocker,
  reportHash,
  summarisePlan,
} from './collective-replicas-migrate-lib.mjs';

const plan = {
  collective: 'c1',
  name: 'Plus 1',
  service_model: 'legacy_copies',
  host_venue_id: 'h1',
  p1: { count: 0, sample_ids: [] },
  p2: { count: 0, sample_ids: [] },
  p3: { count: 0, sample_ids: [] },
  p4: { count: 1, sample_ids: ['v9'] },
  p5: { count: 0, sample_ids: [] },
  checks: {},
  masters: [{ item_id: 'i1', name: 'Haircut', master_service_id: 's1', created_from_service_id: null }],
  page_copy: [],
  links: [
    {
      item_id: 'i1',
      venue_id: 'm1',
      copy_service_id: 's2',
      replaced: [{ column: 'price_pence', before: 1000, after: 2500 }],
      options: [{ copy_variant_id: 'v9', master_variant_id: null, rule: 'kept_inactive', has_bookings: true }],
    },
  ],
  member_only: [{ venue_id: 'm1', service_id: 's3', name: 'Nails', choice: 'add_to_page' }],
  venues: [{ venue_id: 'h1', name: 'Host', is_host: true, stripe_charges_enabled: true, forms_on: false, blocker: null }],
  assignments_to_create: 0,
  bookings_to_snapshot: 2,
};

describe('the signed report', () => {
  it('hashes the same whatever order the keys arrive in', () => {
    const shuffled = JSON.parse(JSON.stringify(plan));
    const reordered = Object.fromEntries(Object.entries(shuffled).reverse());
    expect(reportHash(reordered)).toBe(reportHash(plan));
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: null }] })).toBe('{"a":[{"c":null,"d":2}],"b":1}');
  });

  it('refuses an apply when anything in the plan changed since signing', () => {
    const signed = reportHash(plan);
    expect(planBlocker(plan, signed)).toBeNull();
    const changed = { ...plan, links: [{ ...plan.links[0], replaced: [] }] };
    expect(planBlocker(changed, signed)).toMatch(/changed since it was signed/);
  });

  it('refuses an apply while P1 to P3 are open, even when signed', () => {
    const blocked = { ...plan, p3: { count: 2, sample_ids: [] } };
    expect(planBlocker(blocked, reportHash(blocked))).toBe('P3 has 2 to resolve first');
  });

  it('summarises what the owner is signing', () => {
    const text = summarisePlan(plan);
    expect(text).toContain('P4 1');
    expect(text).toContain('1 value(s) the host');
    expect(text).toContain('1 kept for their bookings');
    expect(text).toContain('1 to add to the page');
  });
});

describe('arguments and the fence', () => {
  it('defaults to a dry run and needs a collective', () => {
    expect(parseArgs(['--collective', 'c1']).mode).toBe('dry-run');
    expect(() => parseArgs([])).toThrow(/--collective/);
    expect(parseArgs(['--survey']).mode).toBe('survey');
  });

  it('will not apply without a signed hash and a named environment', () => {
    const hash = 'a'.repeat(64);
    expect(() => parseArgs(['--collective', 'c1', '--apply', '--env', 'staging'])).toThrow(/approved-report/);
    expect(() => parseArgs(['--collective', 'c1', '--apply', '--approved-report', hash])).toThrow(/--env/);
    expect(parseArgs(['--collective', 'c1', '--apply', '--approved-report', hash, '--env', 'staging']).mode).toBe('apply');
    expect(parseArgs(['--collective', 'c1', '--rollback', '--env', 'staging', '--restore-stale', 'a, b']).restoreStale).toEqual(['a', 'b']);
  });

  it('refuses a write to the wrong project', () => {
    expect(fenceError('staging', PRODUCTION_REF)).toMatch(/production/);
    expect(fenceError('production', 'abcstaging')).toMatch(/abcstaging/);
    expect(fenceError('production', PRODUCTION_REF)).toBeNull();
    expect(fenceError('staging', 'abcstaging')).toBeNull();
  });
});
