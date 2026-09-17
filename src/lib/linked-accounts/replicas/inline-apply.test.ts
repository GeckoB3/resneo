import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeRecordingDb, type Responder } from '@/lib/testing/recording-supabase';
import { applyLinksInline } from './inline-apply';

/**
 * §6.4 "When applies run": a host save applies the members inline within a budget and reports what
 * happened; whatever the budget did not reach is pending and the cron takes it within five minutes.
 */
function db(links: { id: string; venue: string; name: string; behind: boolean }[], onApply: Responder) {
  const responder: Responder = (call) => {
    if (call.table === 'collective_service_replicas') {
      return {
        data: links.map((l) => ({
          id: l.id, venue_id: l.venue, applied_revision: l.behind ? 1 : 2, desired_revision: 2, venues: { name: l.name },
        })),
      };
    }
    return onApply(call);
  };
  return makeRecordingDb(responder);
}

describe('applyLinksInline', () => {
  it('applies only the links that are behind, and counts the venues it reached', async () => {
    const rec = db(
      [{ id: 'l1', venue: 'v1', name: 'Light 3', behind: true }, { id: 'l2', venue: 'v2', name: 'Aura', behind: false }],
      () => ({ data: { ok: true } }),
    );
    const sync = await applyLinksInline(rec.db as unknown as SupabaseClient, ['l1', 'l2']);
    expect(sync).toEqual({ venues: 2, applied: 1, pending: [], failed: [] });
    expect(rec.calls.filter((c) => c.table === 'rpc:collective_apply_replica')).toHaveLength(1);
  });

  it('leaves what the budget did not reach as pending rather than waiting', async () => {
    let now = 0;
    const rec = db(
      [{ id: 'l1', venue: 'v1', name: 'Light 3', behind: true }, { id: 'l2', venue: 'v2', name: 'Aura', behind: true }],
      (call) => (call.table === 'rpc:collective_apply_replica' ? ((now += 5_000), { data: { ok: true } }) : undefined),
    );
    const sync = await applyLinksInline(rec.db as unknown as SupabaseClient, ['l1', 'l2'], { budgetMs: 4_000, now: () => now });
    expect(sync.applied).toBe(1);
    expect(sync.pending).toEqual([{ venue_id: 'v2', venue_name: 'Aura' }]);
  });

  it('passes over a venue whose membership ended mid-save, and reports a real failure', async () => {
    const gone = db([{ id: 'l1', venue: 'v1', name: 'Light 3', behind: true }], () => ({ data: { ok: false, error_code: 'membership_inactive' } }));
    expect(await applyLinksInline(gone.db as unknown as SupabaseClient, ['l1'])).toMatchObject({ applied: 0, failed: [], pending: [] });

    const broke = db([{ id: 'l1', venue: 'v1', name: 'Light 3', behind: true }], () => ({ error: { code: '57014', message: 'timeout' } }));
    const sync = await applyLinksInline(broke.db as unknown as SupabaseClient, ['l1']);
    expect(sync.failed).toEqual([
      { venue_id: 'v1', venue_name: 'Light 3', message: expect.stringContaining('retried automatically'), code: '57014' },
    ]);
  });

  it('reads nothing and reports nothing for an empty list', async () => {
    const rec = db([], () => undefined);
    expect(await applyLinksInline(rec.db as unknown as SupabaseClient, [])).toEqual({ venues: 0, applied: 0, pending: [], failed: [] });
    expect(rec.calls).toHaveLength(0);
  });

  it('never throws when the links cannot be read', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const rec = makeRecordingDb(() => ({ error: { message: 'permission denied' } }));
    expect(await applyLinksInline(rec.db as unknown as SupabaseClient, ['l1'])).toEqual({ venues: 0, applied: 0, pending: [], failed: [] });
    err.mockRestore();
  });
});
