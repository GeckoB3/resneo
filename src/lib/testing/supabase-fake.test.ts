import { describe, it, expect } from 'vitest';
import { createSupabaseFake } from '@/lib/testing/supabase-fake';
import type { FakeRow } from '@/lib/testing/supabase-fake';

/**
 * The fake exists so the parity harness can drive real fetchers. If it silently ignored a
 * filter it would manufacture agreement between paths that actually disagree, which is the
 * one failure mode the harness cannot tolerate. These tests pin the operators the
 * availability fetchers use.
 */
const ids = (rows: FakeRow[] | null): unknown[] => (rows ?? []).map((r) => r.id);

describe('createSupabaseFake', () => {
  const blocks: FakeRow[] = [
    { id: 'a', venue_id: 'v1', service_id: null, block_type: 'closed', date_start: '2026-09-01', date_end: '2026-09-01' },
    { id: 'b', venue_id: 'v1', service_id: 's1', block_type: 'closed', date_start: '2026-09-01', date_end: '2026-09-01' },
    { id: 'c', venue_id: 'v1', service_id: null, block_type: 'amended_hours', date_start: '2026-09-10', date_end: '2026-09-20' },
    { id: 'd', venue_id: 'v2', service_id: null, block_type: 'closed', date_start: '2026-09-01', date_end: '2026-09-01' },
  ];

  it('applies eq, is-null and in together, which is the venue-wide block query', async () => {
    const fake = createSupabaseFake({ tables: { availability_blocks: blocks } });
    const { data, error } = await fake.client
      .from('availability_blocks')
      .select('id')
      .eq('venue_id', 'v1')
      .is('service_id', null)
      .in('block_type', ['closed', 'special_event', 'amended_hours']);

    expect(error).toBeNull();
    expect(ids(data)).toEqual(['a', 'c']);
  });

  it('applies gte/lte as an inclusive date window', async () => {
    const fake = createSupabaseFake({ tables: { availability_blocks: blocks } });
    const { data } = await fake.client
      .from('availability_blocks')
      .select('id')
      .lte('date_start', '2026-09-15')
      .gte('date_end', '2026-09-15');

    expect(ids(data)).toEqual(['c']);
  });

  it('supports not(col, is, null) and rejects other not() forms', async () => {
    const fake = createSupabaseFake({ tables: { availability_blocks: blocks } });
    const { data } = await fake.client.from('availability_blocks').select('id').not('service_id', 'is', null);
    expect(ids(data)).toEqual(['b']);

    expect(() => fake.client.from('availability_blocks').select('id').not('service_id', 'eq', null)).toThrow(
      /not supported/,
    );
  });

  it('supports or() as an eq disjunction and rejects anything else', async () => {
    const rows: FakeRow[] = [
      { id: '1', practitioner_id: 'p1', calendar_id: null },
      { id: '2', practitioner_id: null, calendar_id: 'p1' },
      { id: '3', practitioner_id: 'other', calendar_id: 'other' },
    ];
    const fake = createSupabaseFake({ tables: { calendar_blocks: rows } });
    const { data } = await fake.client
      .from('calendar_blocks')
      .select('id')
      .or('practitioner_id.eq.p1,calendar_id.eq.p1');
    expect(ids(data)).toEqual(['1', '2']);

    expect(() => fake.client.from('calendar_blocks').select('id').or('date_start.gte.2026-01-01')).toThrow(
      /only 'col.eq.value'/,
    );
  });

  it('orders and limits', async () => {
    const fake = createSupabaseFake({ tables: { availability_blocks: blocks } });
    const { data } = await fake.client
      .from('availability_blocks')
      .select('id')
      .eq('venue_id', 'v1')
      .order('date_start', { ascending: false })
      .limit(1);
    expect(ids(data)).toEqual(['c']);
  });

  it('returns the injected error instead of rows, for the fail-open/fail-closed paths', async () => {
    const fake = createSupabaseFake({
      tables: { availability_blocks: blocks },
      errors: { availability_blocks: { message: 'boom' } },
    });
    const { data, error } = await fake.client.from('availability_blocks').select('id').eq('venue_id', 'v1');
    expect(data).toBeNull();
    expect(error).toEqual({ message: 'boom' });
  });

  it('resolves an unknown table to an empty array rather than an error', async () => {
    const fake = createSupabaseFake();
    const { data, error } = await fake.client.from('nothing_here').select('*');
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('maybeSingle returns null on no match; single errors unless exactly one row', async () => {
    const fake = createSupabaseFake({ tables: { venues: [{ id: 'v1' }, { id: 'v2' }] } });

    const miss = await fake.client.from('venues').select('*').eq('id', 'nope').maybeSingle();
    expect(miss).toEqual({ data: null, error: null });

    const one = await fake.client.from('venues').select('*').eq('id', 'v1').single();
    expect(one.error).toBeNull();
    expect(one.data).toEqual({ id: 'v1' });

    const many = await fake.client.from('venues').select('*').single();
    expect(many.data).toBeNull();
    expect(many.error?.code).toBe('PGRST116');
  });

  it('records the table, projection and filters of every query', async () => {
    const fake = createSupabaseFake({ tables: { availability_blocks: blocks } });
    await fake.client.from('availability_blocks').select('id, block_type').eq('venue_id', 'v1').is('service_id', null);

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]!.table).toBe('availability_blocks');
    expect(fake.calls[0]!.select).toBe('id, block_type');
    expect(fake.calls[0]!.filters).toEqual(['eq(venue_id)', 'is(service_id,null)']);
  });

  it('setRows swaps a table between assertions', async () => {
    const fake = createSupabaseFake({ tables: { venues: [{ id: 'v1' }] } });
    fake.setRows('venues', [{ id: 'v9' }]);
    const { data } = await fake.client.from('venues').select('*');
    expect(data).toEqual([{ id: 'v9' }]);
  });

  it('casts to a fetcher parameter type without leaking the cast to call sites', () => {
    const fake = createSupabaseFake({ tables: { venues: [{ id: 'v1' }] } });
    const client = fake.asSupabaseClient<{ from(t: string): { select(c: string): unknown } }>();
    expect(typeof client.from('venues').select).toBe('function');
  });
});
