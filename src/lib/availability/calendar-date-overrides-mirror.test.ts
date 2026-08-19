import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  mirrorLeaveDelete,
  mirrorLeaveInsert,
  mirrorLeaveUpdate,
  type LeaveRowForMirror,
} from '@/lib/availability/calendar-date-overrides-mirror';

/**
 * Stage 6a dual-write.
 *
 * The behaviour under test is mostly NEGATIVE: what the mirror must not do to the leave
 * write it accompanies. A mirror that throws, or that reports a failure the route turns
 * into a 500, would make a venue unable to save a holiday because of a table nothing reads.
 */

const LEAVE: LeaveRowForMirror = {
  id: 'leave-1',
  venue_id: 'venue-1',
  practitioner_id: 'cal-1',
  start_date: '2030-06-05',
  end_date: '2030-06-07',
  leave_type: 'holiday',
  notes: 'Away',
  unavailable_start_time: null,
  unavailable_end_time: null,
  created_at: '2030-05-01T09:00:00Z',
};

interface Call {
  table: string;
  op: 'insert' | 'update' | 'delete';
  payload?: unknown;
  filters: string[];
}

/**
 * Minimal write-capable stub. The shared `supabase-fake` reads only, and extending it for
 * three call sites would be more surface than a purpose-built stub that fails loudly on
 * anything it does not model.
 */
function stub(opts: { error?: unknown; updateMatches?: number; throwOn?: 'insert' | 'update' | 'delete' } = {}) {
  const calls: Call[] = [];
  const error = opts.error ?? null;

  function builder(table: string, op: Call['op'], payload?: unknown) {
    const call: Call = { table, op, payload, filters: [] };
    calls.push(call);
    if (opts.throwOn === op) throw new Error('connection reset');

    const result =
      op === 'update'
        ? { data: Array.from({ length: opts.updateMatches ?? 1 }, (_, i) => ({ id: `ov-${i}` })), error }
        : { data: null, error };

    const chain = {
      eq(column: string, value: unknown) {
        call.filters.push(`${column}=${String(value)}`);
        return chain;
      },
      select() {
        return Promise.resolve(result);
      },
      then(resolve: (v: typeof result) => unknown) {
        return Promise.resolve(result).then(resolve);
      },
    };
    return chain;
  }

  const client = {
    from(table: string) {
      return {
        insert: (payload: unknown) => builder(table, 'insert', payload),
        update: (payload: unknown) => builder(table, 'update', payload),
        delete: () => builder(table, 'delete'),
      };
    },
  };

  return { calls, client: client as unknown as SupabaseClient };
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('mirrorLeaveInsert', () => {
  it('writes one closed override per leave row, carrying leave_type and notes', async () => {
    const { calls, client } = stub();
    await mirrorLeaveInsert(client, [LEAVE], 'test');

    expect(calls).toHaveLength(1);
    expect(calls[0]!.table).toBe('calendar_date_overrides');
    expect((calls[0]!.payload as Record<string, unknown>[])[0]).toEqual({
      venue_id: 'venue-1',
      calendar_id: 'cal-1',
      override_kind: 'closed',
      date_start: '2030-06-05',
      date_end: '2030-06-07',
      time_start: null,
      time_end: null,
      leave_type: 'holiday',
      notes: 'Away',
      source_leave_id: 'leave-1',
      created_at: '2030-05-01T09:00:00Z',
    });
  });

  it('carries a partial-day window through unchanged', async () => {
    const { calls, client } = stub();
    await mirrorLeaveInsert(
      client,
      [{ ...LEAVE, unavailable_start_time: '13:00', unavailable_end_time: '15:00' }],
      'test',
    );

    const row = (calls[0]!.payload as Record<string, unknown>[])[0]!;
    expect(row.time_start).toBe('13:00');
    expect(row.time_end).toBe('15:00');
  });

  it('omits created_at when the leave row has none, so the column default applies', async () => {
    const { calls, client } = stub();
    await mirrorLeaveInsert(client, [{ ...LEAVE, created_at: null }], 'test');

    expect((calls[0]!.payload as Record<string, unknown>[])[0]).not.toHaveProperty('created_at');
  });

  it('mirrors every row of an apply-to-all-calendars save in one statement', async () => {
    const { calls, client } = stub();
    await mirrorLeaveInsert(
      client,
      [LEAVE, { ...LEAVE, id: 'leave-2', practitioner_id: 'cal-2' }],
      'test',
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]!.payload as unknown[]).toHaveLength(2);
  });

  /** The migration's backfill inner-joins `unified_calendars` and skips these identically. */
  it('skips a leave row with no calendar rather than writing an unusable override', async () => {
    const { calls, client } = stub();
    await mirrorLeaveInsert(client, [{ ...LEAVE, practitioner_id: null }], 'test');

    expect(calls).toHaveLength(0);
  });

  it('issues no statement at all for an empty batch', async () => {
    const { calls, client } = stub();
    await mirrorLeaveInsert(client, [], 'test');

    expect(calls).toHaveLength(0);
  });

  /** The point of the module. A venue saving a holiday must not be blocked by the mirror. */
  it('RESOLVES rather than throwing when the insert returns an error', async () => {
    const { client } = stub({ error: { message: 'relation does not exist', code: '42P01' } });

    await expect(mirrorLeaveInsert(client, [LEAVE], 'test')).resolves.toBeUndefined();
  });

  it('RESOLVES rather than throwing when the client itself throws', async () => {
    const { client } = stub({ throwOn: 'insert' });

    await expect(mirrorLeaveInsert(client, [LEAVE], 'test')).resolves.toBeUndefined();
  });
});

describe('mirrorLeaveUpdate', () => {
  it('updates the mirror row matched by source_leave_id', async () => {
    const { calls, client } = stub({ updateMatches: 1 });
    await mirrorLeaveUpdate(client, { ...LEAVE, end_date: '2030-06-09' }, 'test');

    expect(calls).toHaveLength(1);
    expect(calls[0]!.op).toBe('update');
    expect(calls[0]!.filters).toContain('source_leave_id=leave-1');
    expect((calls[0]!.payload as Record<string, unknown>).date_end).toBe('2030-06-09');
  });

  it('never rewrites source_leave_id or created_at on an update', async () => {
    const { calls, client } = stub({ updateMatches: 1 });
    await mirrorLeaveUpdate(client, LEAVE, 'test');

    expect(calls[0]!.payload).not.toHaveProperty('source_leave_id');
    expect(calls[0]!.payload).not.toHaveProperty('created_at');
  });

  /**
   * Self-repair. An insert lost to an earlier fail-soft path comes back the next time
   * anyone edits that leave period, which is why no reconciliation job is scheduled.
   */
  it('INSERTS when no mirror row matched, repairing a row lost to an earlier failure', async () => {
    const { calls, client } = stub({ updateMatches: 0 });
    await mirrorLeaveUpdate(client, LEAVE, 'test');

    expect(calls).toHaveLength(2);
    expect(calls[1]!.op).toBe('insert');
    expect((calls[1]!.payload as Record<string, unknown>[])[0]!.source_leave_id).toBe('leave-1');
  });

  it('does not attempt the repair insert when the update itself errored', async () => {
    const { calls, client } = stub({ error: { message: 'permission denied' }, updateMatches: 0 });
    await mirrorLeaveUpdate(client, LEAVE, 'test');

    expect(calls).toHaveLength(1);
  });

  it('RESOLVES rather than throwing when the client throws', async () => {
    const { client } = stub({ throwOn: 'update' });

    await expect(mirrorLeaveUpdate(client, LEAVE, 'test')).resolves.toBeUndefined();
  });
});

describe('mirrorLeaveDelete', () => {
  it('deletes by source_leave_id, scoped to the venue', async () => {
    const { calls, client } = stub();
    await mirrorLeaveDelete(client, 'leave-1', 'venue-1', 'test');

    expect(calls).toHaveLength(1);
    expect(calls[0]!.op).toBe('delete');
    expect(calls[0]!.filters).toEqual(['source_leave_id=leave-1', 'venue_id=venue-1']);
  });

  it('RESOLVES rather than throwing when the delete errors', async () => {
    const { client } = stub({ error: { message: 'timeout' } });

    await expect(mirrorLeaveDelete(client, 'leave-1', 'venue-1', 'test')).resolves.toBeUndefined();
  });
});
