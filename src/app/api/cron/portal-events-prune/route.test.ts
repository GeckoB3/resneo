import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { makeRecordingDb } from '@/lib/testing/recording-supabase';

const hoisted = vi.hoisted(() => ({
  db: null as ReturnType<typeof makeRecordingDb> | null,
  deleteError: null as { message: string } | null,
}));

vi.mock('@/lib/supabase', () => ({ getSupabaseAdminClient: () => hoisted.db!.db }));
vi.mock('@/lib/platform/cron-log', () => ({
  withCronRunLogging: (_job: string, handler: unknown) => handler,
}));

import { POST, retentionCutoffIso } from './route';

function req(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost:3000/api/cron/portal-events-prune', {
    method: 'POST',
    headers,
  });
}

describe('portal-events-prune cron', () => {
  beforeEach(() => {
    delete process.env.CRON_SECRET;
    hoisted.deleteError = null;
    hoisted.db = makeRecordingDb((call) =>
      call.op === 'delete'
        ? { data: null, error: hoisted.deleteError, count: hoisted.deleteError ? null : 7 }
        : undefined,
    );
  });
  afterEach(() => vi.useRealTimers());

  it('prunes strictly older than 13 months', () => {
    // 13, not 12: §5B compares a period against the same period a year
    // earlier, so twelve months is the working set and the extra month is the
    // margin that keeps a year-on-year comparison whole while a prune runs.
    // A 12-month cutoff would silently destroy the comparison.
    const cutoff = retentionCutoffIso(new Date('2026-08-27T00:00:00.000Z'));
    expect(cutoff).toBe('2025-07-27T00:00:00.000Z');
  });

  it('deletes only rows before the cutoff', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-27T00:00:00.000Z'));
    const res = await POST(req());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, pruned: 7 });

    const del = hoisted.db!.calls.find((c) => c.op === 'delete');
    expect(del?.table).toBe('portal_events');
    // A prune with no upper-bound predicate would empty the table.
    expect(del?.filters).toEqual([['lt', 'created_at', '2025-07-27T00:00:00.000Z']]);
  });

  it('rejects an unauthorised caller when CRON_SECRET is set', async () => {
    process.env.CRON_SECRET = 'sekrit';
    const res = await POST(req());
    expect(res.status).toBe(401);
    // And nothing was deleted.
    expect(hoisted.db!.calls.filter((c) => c.op === 'delete')).toEqual([]);
  });

  it('accepts the bearer secret', async () => {
    process.env.CRON_SECRET = 'sekrit';
    const res = await POST(req({ authorization: 'Bearer sekrit' }));
    expect(res.status).toBe(200);
  });

  it('reports a delete failure as a 500 rather than a silent success', async () => {
    hoisted.deleteError = { message: 'permission denied' };
    const res = await POST(req());
    expect(res.status).toBe(500);
  });
});
