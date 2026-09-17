/**
 * FAIR-01 (SB-40): "Any available" on the collective page follows the host's setting and does not
 * hand the host every contested time.
 */
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeRecordingDb } from '@/lib/testing/recording-supabase';
import { loadHostAnyAvailableConfig, pickCollectiveSlot, poolCollectiveSlots } from './collective-any-available';

const priority = { mode: 'priority' as const, calendar_order: [] as string[] };

const day = (times: string[], calendars: string[]) =>
  times.flatMap((t) => calendars.map((c) => ({ start_time: `${t}:00`, practitioner_id: c })));

const hours = Array.from({ length: 40 }, (_, i) => {
  const minutes = 9 * 60 + i * 15;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
});

describe('poolCollectiveSlots', () => {
  it('keeps one slot per time, in time order', () => {
    const pooled = poolCollectiveSlots(day(['11:00', '09:00'], ['host-1', 'zen-1']), priority, '2031-03-04');
    expect(pooled.map((s) => s.start_time)).toEqual(['09:00:00', '11:00:00']);
  });

  it('shares contested times across venues when no order is set, the same way every time', () => {
    const slots = day(hours, ['host-1', 'zen-1', 'bloom-1']);
    const pooled = poolCollectiveSlots(slots, priority, '2031-03-04');
    const counts = new Map<string, number>();
    for (const s of pooled) counts.set(s.practitioner_id, (counts.get(s.practitioner_id) ?? 0) + 1);
    expect(counts.size).toBe(3);
    for (const n of counts.values()) expect(n).toBeGreaterThanOrEqual(5);
    // Stable: a refresh offers the same person for the same time.
    expect(poolCollectiveSlots([...slots].reverse(), priority, '2031-03-04')).toEqual(pooled);
  });

  it("follows the host's chosen order for the calendars it names", () => {
    const config = { mode: 'priority' as const, calendar_order: ['zen-1', 'host-1'] };
    const pooled = poolCollectiveSlots(day(hours, ['host-1', 'zen-1', 'bloom-1']), config, '2031-03-04');
    expect(new Set(pooled.map((s) => s.practitioner_id))).toEqual(new Set(['zen-1']));
  });

  it('picks at random in random mode', () => {
    const candidates = [
      { start_time: '10:00', practitioner_id: 'host-1' },
      { start_time: '10:00', practitioner_id: 'zen-1' },
    ];
    const config = { mode: 'random' as const, calendar_order: [] };
    expect(pickCollectiveSlot(candidates, config, '2031-03-04', () => 0.9)?.practitioner_id).toBe('zen-1');
    expect(pickCollectiveSlot(candidates, config, '2031-03-04', () => 0.1)?.practitioner_id).toBe('host-1');
  });
});

describe('loadHostAnyAvailableConfig', () => {
  it("reads the host venue's setting", async () => {
    const db = makeRecordingDb((call) => {
      if (call.table === 'venue_collectives') return { data: { host_venue_id: 'host' } };
      if (call.table === 'venues') {
        return { data: { feature_flags: { any_available_practitioner_config: { mode: 'random', calendar_order: [] } } } };
      }
      return undefined;
    }).db as unknown as SupabaseClient;
    expect((await loadHostAnyAvailableConfig(db, 'col-1')).mode).toBe('random');
  });
});
