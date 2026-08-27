/**
 * P0-0 acceptance: "P0-3's query-count assertion and one P0-9 write assertion
 * are both expressible using only this module." The two tests marked below ARE
 * those expressions, exercised against small stand-ins for the real code so the
 * shapes are proven before P0-3 and P0-9 lean on them.
 */
import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeRecordingDb, makeAfterStub, PG_ERRORS } from './recording-supabase';

describe('makeRecordingDb', () => {
  it('records table, op, payload, projection and filters in call order', async () => {
    const { db, calls } = makeRecordingDb((call) =>
      call.table === 'bookings' ? { data: [{ id: 'b1' }] } : undefined,
    );

    await db.from('bookings').select('id, status').eq('venue_id', 'v1').in('guest_id', ['g1', 'g2']).order('booking_date', { ascending: false }).limit(10);
    await db.from('bookings').update({ status: 'Cancelled' }).eq('id', 'b1').select('id').single();

    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      table: 'bookings',
      op: 'select',
      columns: 'id, status',
      filters: [
        ['eq', 'venue_id', 'v1'],
        ['in', 'guest_id', ['g1', 'g2']],
        ['order', 'booking_date', { ascending: false }],
        ['limit', 10],
      ],
    });
    // update().select() is RETURNING, not a second read.
    expect(calls[1]).toMatchObject({
      table: 'bookings',
      op: 'update',
      payload: { status: 'Cancelled' },
      filters: [['eq', 'id', 'b1'], ['returning', 'id']],
    });
  });

  it('defaults are realistic: single() over nothing is PGRST116, never a silent null', async () => {
    const { db } = makeRecordingDb();
    expect(await db.from('bookings').select('*')).toMatchObject({ data: [], error: null });
    expect(await db.from('bookings').select('*').maybeSingle()).toMatchObject({ data: null, error: null });
    expect(await db.from('bookings').select('*').single()).toMatchObject({ error: { code: 'PGRST116' } });
  });

  it('records rpc calls with their arguments', async () => {
    const { db, calls } = makeRecordingDb(() => ({ data: null }));
    await db.rpc('claim_user_account', { p_email: 'a@b.test' });
    expect(calls[0]).toMatchObject({
      table: 'rpc:claim_user_account',
      op: 'rpc',
      payload: { p_email: 'a@b.test' },
    });
  });

  /**
   * ACCEPTANCE (P0-3 shape): a loader hydrating N rows must issue a bounded
   * number of queries, asserted by queryCount(); and a forced 23505 fails once
   * then yields to the responder, which is the retry-then-re-select contract
   * P0-3 fixes createOrGetBookingShortLink to honour.
   */
  it('expresses the P0-3 query-count and 23505-injection assertions', async () => {
    const { db, queryCount, inject } = makeRecordingDb((call) => {
      if (call.table === 'bookings') {
        return { data: Array.from({ length: 100 }, (_, i) => ({ id: `b${i}` })) };
      }
      if (call.table === 'booking_short_links') return { data: { code: 'WON' } };
      return undefined;
    });

    // A batched loader: one bookings read, one set-based context read. Not per-row.
    const loadList = async (client: SupabaseClient) => {
      const { data } = await client.from('bookings').select('*').in('guest_id', ['g1']);
      await client.from('class_instances').select('*').in('id', ['c1', 'c2']);
      return data;
    };
    const rows = (await loadList(db)) as unknown[];
    expect(rows).toHaveLength(100);
    expect(queryCount()).toBeLessThan(10);
    expect(queryCount({ table: 'bookings', op: 'select' })).toBe(1);

    // Forced 23505 once: the insert fails, the re-select reaches the responder
    // and returns the winning row instead of colliding twelve times.
    inject((c) => c.table === 'booking_short_links' && c.op === 'insert', PG_ERRORS.uniqueViolation);
    const first = await db.from('booking_short_links').insert({ code: 'MINE' }).select('code').single();
    expect(first.error).toMatchObject({ code: '23505' });
    const reselect = await db.from('booking_short_links').select('code').single();
    expect(reselect).toMatchObject({ data: { code: 'WON' }, error: null });
  });

  /**
   * ACCEPTANCE (P0-9 shape): a cancel path writes the bookings update with
   * exact keys and queues comms inside after(); the write is asserted from the
   * call log and the comms from the OUTCOME (the send happened), not from the
   * stub's internals.
   */
  it('expresses a P0-9 write assertion with the after() flush', async () => {
    const { db, calls } = makeRecordingDb((call) =>
      call.op === 'update' ? { data: [{ id: 'b1' }] } : { data: { id: 'b1', status: 'Confirmed' } },
    );
    const after = makeAfterStub();
    const sent: string[] = [];

    const cancelBooking = async (client: SupabaseClient) => {
      await client
        .from('bookings')
        .update({ status: 'Cancelled', cancellation_actor_type: 'guest' })
        .eq('id', 'b1');
      after(() => { sent.push('cancellation-email:b1'); });
      return { ok: true };
    };
    await cancelBooking(db);

    const update = calls.find((c) => c.op === 'update');
    expect(update?.table).toBe('bookings');
    // Exact keys, per P0-9's matrix: an extra or missing key is a behaviour change.
    expect(Object.keys(update?.payload as Record<string, unknown>).sort()).toEqual([
      'cancellation_actor_type',
      'status',
    ]);
    // The deferred work RAN: a bare vi.fn() here would leave `sent` empty and
    // this assertion is what catches anyone "simplifying" the stub.
    expect(sent).toEqual(['cancellation-email:b1']);
  });

  it('injection respects times and then stops', async () => {
    const { db, inject } = makeRecordingDb(() => ({ data: [{ id: 'r1' }] }));
    inject((c) => c.table === 't', PG_ERRORS.exclusionViolation, { times: 2 });
    expect((await db.from('t').select('*')).error).toMatchObject({ code: '23P01' });
    expect((await db.from('t').select('*')).error).toMatchObject({ code: '23P01' });
    expect((await db.from('t').select('*')).error).toBeNull();
  });
});
