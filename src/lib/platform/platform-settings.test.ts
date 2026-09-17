/** D37: the model new collectives start on, read safely and written with who changed it. */
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeRecordingDb } from '@/lib/testing/recording-supabase';
import { newCollectiveServiceModel, setNewCollectiveServiceModel } from './platform-settings';

const dbWith = (value: unknown, error: { message: string } | null = null) =>
  makeRecordingDb((call) => (call.table === 'platform_settings' ? { data: value === undefined ? null : { value }, error } : undefined));

describe('newCollectiveServiceModel', () => {
  it('reads the console setting', async () => {
    expect(await newCollectiveServiceModel(dbWith('replicas').db as unknown as SupabaseClient)).toBe('replicas');
    expect(await newCollectiveServiceModel(dbWith('legacy_copies').db as unknown as SupabaseClient)).toBe('legacy_copies');
  });

  it('never switches anything on when the setting is missing or unreadable', async () => {
    expect(await newCollectiveServiceModel(dbWith(undefined).db as unknown as SupabaseClient)).toBe('legacy_copies');
    expect(
      await newCollectiveServiceModel(dbWith(null, { message: 'relation does not exist' }).db as unknown as SupabaseClient),
    ).toBe('legacy_copies');
    expect(await newCollectiveServiceModel(dbWith('something-else').db as unknown as SupabaseClient)).toBe('legacy_copies');
  });
});

describe('setNewCollectiveServiceModel', () => {
  it('upserts the value with who changed it, and reports the old one', async () => {
    const rec = dbWith('legacy_copies');
    const result = await setNewCollectiveServiceModel(rec.db as unknown as SupabaseClient, 'replicas', 'user-1');
    expect(result).toEqual({ ok: true, previous: 'legacy_copies' });
    const write = rec.calls.find((c) => c.table === 'platform_settings' && c.op === 'upsert');
    expect(write?.payload).toMatchObject({ key: 'new_collective_service_model', value: 'replicas', updated_by: 'user-1' });
  });
});
