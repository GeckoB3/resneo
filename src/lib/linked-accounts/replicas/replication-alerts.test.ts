/**
 * §6.16's clock-based alerts: a link behind for over an hour, and a replication cron that has
 * stopped completing.
 */
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeRecordingDb } from '@/lib/testing/recording-supabase';
import { countLinksBehindTooLong, replicateStaleMinutes } from './replication-alerts';

const NOW = Date.parse('2026-10-01T12:00:00Z');

describe('countLinksBehindTooLong', () => {
  it('counts live links behind for more than an hour', async () => {
    const recording = makeRecordingDb((call) => (call.table === 'collective_service_replicas' ? { data: null, count: 2 } : undefined));
    expect(await countLinksBehindTooLong(recording.db as unknown as SupabaseClient, NOW)).toBe(2);
    expect(recording.calls[0]!.filters).toEqual(
      expect.arrayContaining([
        ['is', 'released_at', null],
        ['lt', 'behind_since', '2026-10-01T11:00:00.000Z'],
      ]),
    );
  });
});

describe('replicateStaleMinutes', () => {
  const lastRun = (finishedAt: string | null) =>
    makeRecordingDb((call) => (call.table === 'cron_runs' ? { data: finishedAt ? { finished_at: finishedAt } : null } : undefined));

  it('is quiet when the last run completed recently', async () => {
    expect(await replicateStaleMinutes(lastRun('2026-10-01T11:55:00Z').db as unknown as SupabaseClient, NOW)).toBeNull();
  });

  it('reports the gap once it is over 30 minutes', async () => {
    expect(await replicateStaleMinutes(lastRun('2026-10-01T11:15:00Z').db as unknown as SupabaseClient, NOW)).toBe(45);
  });

  it('is quiet when the cron has never run, and looks only at completed runs before this one', async () => {
    const recording = lastRun(null);
    expect(await replicateStaleMinutes(recording.db as unknown as SupabaseClient, NOW)).toBeNull();
    expect(recording.calls[0]!.filters).toEqual(
      expect.arrayContaining([
        ['eq', 'job_name', 'collective-replicate'],
        ['eq', 'ok', true],
        ['lt', 'started_at', '2026-10-01T12:00:00.000Z'],
      ]),
    );
  });
});
