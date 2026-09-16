/**
 * Telling members what the host changed (UX spec §4 N6 and N7).
 *
 * A price change reaches every member promptly and cannot be switched off; everything else waits
 * for the 18:00 digest. The guards are the split between the two, the grouping that keeps a burst
 * of saves to one email, and never replaying history at a venue that has only just started
 * listening.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeRecordingDb, type Responder } from '@/lib/testing/recording-supabase';

const notifyVenue = vi.fn(async () => ({ emailFailures: 0 }));
vi.mock('@/lib/linked-accounts/notifications', () => ({
  notifyVenue: (...args: unknown[]) => notifyVenue(...(args as [])),
}));

import {
  classifyMasterChange,
  COMMERCIAL_QUIET_MS,
  localClock,
  sendMasterChangeNotices,
} from './master-change-notices';

describe('classifyMasterChange', () => {
  it('puts a price change in the commercial notice, with both prices', () => {
    const { commercial, other } = classifyMasterChange(
      { before: { service: { price_pence: 6000 } }, after: { service: { price_pence: 6500 } } },
      '£',
    );
    expect(commercial).toEqual([{ label: 'Price', from: '£60.00', to: '£65.00' }]);
    expect(other).toEqual([]);
  });

  it('keeps a rename for the digest', () => {
    const { commercial, other } = classifyMasterChange(
      { before: { service: { name: 'Facial' } }, after: { service: { name: 'Deep facial' } } },
      '£',
    );
    expect(commercial).toEqual([]);
    expect(other).toEqual(['Name']);
  });

  it('treats an option price change as commercial, and an option rename as not', () => {
    const priced = classifyMasterChange(
      {
        before: { service: {}, variants: [{ key: 'v1', name: 'Short', price_pence: 4000 }] },
        after: { service: {}, variants: [{ key: 'v1', name: 'Short', price_pence: 4500 }] },
      },
      '£',
    );
    expect(priced.commercial).toEqual([{ label: 'Options', from: 'Short (£40.00)', to: 'Short (£45.00)' }]);

    const renamed = classifyMasterChange(
      {
        before: { service: {}, variants: [{ key: 'v1', name: 'Short', price_pence: 4000 }] },
        after: { service: {}, variants: [{ key: 'v1', name: 'Quick', price_pence: 4000 }] },
      },
      '£',
    );
    expect(renamed.commercial).toEqual([]);
    expect(renamed.other).toEqual(['Option names']);
  });

  it('writes an emptied deposit as None, and the payment rule in words', () => {
    const { commercial } = classifyMasterChange(
      {
        before: { service: { deposit_pence: 1000, payment_requirement: 'deposit' } },
        after: { service: { deposit_pence: null, payment_requirement: 'none' } },
      },
      '€',
    );
    expect(commercial).toEqual([
      { label: 'Deposit', from: '€10.00', to: 'None' },
      { label: 'Online payment', from: 'A deposit', to: 'Nothing online' },
    ]);
  });

  it('notices a heading change', () => {
    expect(
      classifyMasterChange({ before: { heading: { name: 'Face' } }, after: { heading: { name: 'Skin' } } }, '£').other,
    ).toEqual(['Heading']);
  });
});

describe('localClock', () => {
  it("reads the member's own time, summer time included", () => {
    // 17:30 UTC in September is 18:30 in London.
    expect(localClock(Date.parse('2026-09-16T17:30:00Z'), 'Europe/London')).toEqual({ date: '2026-09-16', hour: 18 });
    expect(localClock(Date.parse('2026-09-16T17:30:00Z'), 'Europe/Dublin').hour).toBe(18);
  });

  it('falls back to London for a timezone it cannot read', () => {
    expect(localClock(Date.parse('2026-01-16T18:30:00Z'), 'Not/AZone')).toEqual({ date: '2026-01-16', hour: 18 });
  });
});

// ─── The pass itself ──────────────────────────────────────────────────────────────────────────

const NOW = Date.parse('2026-09-16T17:30:00Z'); // 18:30 in London: digest time.
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const priceChange = (at: string, id = 'a1') => ({
  id,
  collective_id: 'collective-1',
  event_type: 'master_changed',
  service_id: 'svc-1',
  created_at: at,
  changes: { before: { service: { price_pence: 6000 } }, after: { service: { price_pence: 6500 } } },
});

const rename = (at: string) => ({
  id: 'a2',
  collective_id: 'collective-1',
  event_type: 'master_changed',
  service_id: 'svc-1',
  created_at: at,
  changes: { before: { service: { name: 'Facial' } }, after: { service: { name: 'Deep facial' } } },
});

function world(opts: {
  audit?: Record<string, unknown>[];
  marks?: Partial<Record<'commercial' | 'digest', string | null>>;
  prefs?: Record<string, boolean> | null;
}): Responder {
  return (call) => {
    if (call.table === 'venue_collectives') {
      return { data: [{ id: 'collective-1', name: 'Northside', host_venue_id: 'host' }] };
    }
    if (call.table === 'venue_collective_members') {
      return { data: [{ collective_id: 'collective-1', venue_id: 'host' }, { collective_id: 'collective-1', venue_id: 'member' }] };
    }
    if (call.table === 'venues') {
      return {
        data: [
          { id: 'host', name: 'Host Venue', timezone: 'Europe/London', currency: 'GBP', linked_notification_prefs: null },
          { id: 'member', name: 'Zen Studio', timezone: 'Europe/London', currency: 'GBP', linked_notification_prefs: opts.prefs ?? null },
        ],
      };
    }
    if (call.table === 'collective_notice_marks' && call.op === 'select') {
      const kind = call.filters.find((f) => f[0] === 'eq' && f[1] === 'kind')?.[2] as 'commercial' | 'digest';
      const mark = opts.marks?.[kind];
      return { data: mark ? { sent_through: mark } : null };
    }
    if (call.table === 'collective_audit_events') {
      const after = call.filters.find((f) => f[0] === 'gt')?.[2] as string | undefined;
      return { data: (opts.audit ?? []).filter((r) => !after || String(r.created_at) > after) };
    }
    if (call.table === 'service_items') return { data: [{ id: 'svc-1', name: 'Facial' }] };
    return undefined;
  };
}

const pass = (responder: Responder, now = NOW) => {
  const recording = makeRecordingDb(responder);
  return { recording, outcome: sendMasterChangeNotices(recording.db as unknown as SupabaseClient, { now: () => now }) };
};

const marksWritten = (calls: { table: string; op: string; payload?: unknown }[]) =>
  calls
    .filter((c) => c.table === 'collective_notice_marks' && c.op === 'upsert')
    .map((c) => c.payload as { kind: string; sent_through: string; venue_id: string });

beforeEach(() => {
  notifyVenue.mockClear();
});

describe('sendMasterChangeNotices: commercial (N6)', () => {
  it('emails every member the price change once the host has stopped saving', async () => {
    const { recording, outcome } = pass(
      world({ audit: [priceChange(ago(COMMERCIAL_QUIET_MS + 1000))], marks: { commercial: ago(60 * 60 * 1000), digest: ago(1000) } }),
    );
    expect((await outcome).commercial).toBe(1);
    const [, venueId, subject, params] = notifyVenue.mock.calls[0] as unknown as [
      unknown,
      string,
      string,
      { bullets: string[] },
    ];
    expect(venueId).toBe('member');
    expect(subject).toBe('Host Venue changed Facial');
    expect(params.bullets).toEqual(['Facial: Price: £60.00 to £65.00']);
    expect(marksWritten(recording.calls)).toContainEqual(
      expect.objectContaining({ kind: 'commercial', sent_through: ago(COMMERCIAL_QUIET_MS + 1000) }),
    );
  });

  it('waits while the host is still saving, so a burst is one email', async () => {
    const { outcome } = pass(
      world({ audit: [priceChange(ago(60_000))], marks: { commercial: ago(60 * 60 * 1000), digest: ago(1000) } }),
    );
    expect((await outcome).commercial).toBe(0);
    expect(notifyVenue).not.toHaveBeenCalled();
  });

  it('never replays history at a venue that has only just started listening', async () => {
    const { recording, outcome } = pass(
      world({ audit: [priceChange(ago(COMMERCIAL_QUIET_MS * 10))], marks: { commercial: null, digest: ago(1000) } }),
    );
    expect((await outcome).commercial).toBe(0);
    expect(notifyVenue).not.toHaveBeenCalled();
    expect(marksWritten(recording.calls)).toContainEqual(
      expect.objectContaining({ kind: 'commercial', sent_through: new Date(NOW).toISOString() }),
    );
  });

  it('says the host put it back when the change was undone', async () => {
    const at = ago(COMMERCIAL_QUIET_MS + 5000);
    const { outcome } = pass(
      world({
        audit: [
          priceChange(at),
          { ...priceChange(ago(COMMERCIAL_QUIET_MS + 1000), 'a3'), event_type: 'master_change_undone', changes: null },
        ],
        marks: { commercial: ago(60 * 60 * 1000), digest: ago(1000) },
      }),
    );
    await outcome;
    const [, , , params] = notifyVenue.mock.calls[0] as unknown as [unknown, string, string, { bullets: string[] }];
    expect(params.bullets).toEqual([
      'Facial: Price: £60.00 to £65.00',
      'Host Venue put Facial back to how it was.',
    ]);
  });

  it('sends nothing, and moves on, when the saves were not commercial', async () => {
    const { recording, outcome } = pass(
      world({ audit: [rename(ago(COMMERCIAL_QUIET_MS + 1000))], marks: { commercial: ago(60 * 60 * 1000), digest: ago(1000) } }),
    );
    expect((await outcome).commercial).toBe(0);
    expect(marksWritten(recording.calls)).toContainEqual(expect.objectContaining({ kind: 'commercial' }));
  });
});

describe('sendMasterChangeNotices: digest (N7)', () => {
  const yesterdayEvening = new Date(Date.parse('2026-09-15T17:10:00Z')).toISOString();

  it("sends the day's other changes at 18:00 their time", async () => {
    const { recording, outcome } = pass(
      world({ audit: [rename(ago(60 * 60 * 1000))], marks: { commercial: new Date(NOW).toISOString(), digest: yesterdayEvening } }),
    );
    expect((await outcome).digests).toBe(1);
    const call = notifyVenue.mock.calls.find((c) => (c as unknown as [unknown, string, string])[2] === 'Changes from Host Venue today');
    expect(call).toBeTruthy();
    expect((call as unknown as [unknown, string, string, { bullets: string[] }])[3].bullets).toEqual(['Facial: Name']);
    expect(marksWritten(recording.calls)).toContainEqual(
      expect.objectContaining({ kind: 'digest', sent_through: new Date(NOW).toISOString() }),
    );
  });

  it('waits until 18:00', async () => {
    const morning = Date.parse('2026-09-16T08:00:00Z');
    const { outcome } = pass(
      world({ audit: [rename(ago(60 * 60 * 1000))], marks: { commercial: new Date(morning).toISOString(), digest: yesterdayEvening } }),
      morning,
    );
    expect((await outcome).digests).toBe(0);
    expect(notifyVenue).not.toHaveBeenCalled();
  });

  it('sends once a day, not every run after 18:00', async () => {
    const { outcome } = pass(
      world({
        audit: [rename(ago(60 * 1000))],
        marks: { commercial: new Date(NOW).toISOString(), digest: new Date(Date.parse('2026-09-16T17:05:00Z')).toISOString() },
      }),
    );
    expect((await outcome).digests).toBe(0);
  });

  it('skips an empty day', async () => {
    const { outcome } = pass(
      world({ audit: [], marks: { commercial: new Date(NOW).toISOString(), digest: yesterdayEvening } }),
    );
    expect((await outcome).digests).toBe(0);
    expect(notifyVenue).not.toHaveBeenCalled();
  });

  it('rings the bell instead of emailing a member that turned the digest off', async () => {
    const { recording, outcome } = pass(
      world({
        audit: [rename(ago(60 * 60 * 1000))],
        marks: { commercial: new Date(NOW).toISOString(), digest: yesterdayEvening },
        prefs: { collective_digest: false },
      }),
    );
    expect((await outcome).digests).toBe(1);
    expect(notifyVenue).not.toHaveBeenCalled();
    const bell = recording.calls.find((c) => c.table === 'account_link_notifications');
    expect((bell?.payload as { venue_id: string; payload: { title: string } }).payload.title).toBe(
      'Changes from Host Venue today',
    );
  });
});

describe('sendMasterChangeNotices: quiet when there is nothing', () => {
  it('reads one table and stops when no collective is on the new model, which is every one today', async () => {
    const recording = makeRecordingDb((call) => (call.table === 'venue_collectives' ? { data: [] } : undefined));
    expect(await sendMasterChangeNotices(recording.db as unknown as SupabaseClient, { now: () => NOW })).toEqual({
      commercial: 0,
      digests: 0,
    });
    expect(recording.calls).toHaveLength(1);
  });

  it('never tells the host about its own changes', async () => {
    await pass(
      world({ audit: [priceChange(ago(COMMERCIAL_QUIET_MS + 1000))], marks: { commercial: ago(60 * 60 * 1000), digest: ago(1000) } }),
    ).outcome;
    expect(notifyVenue.mock.calls.map((c) => (c as unknown as [unknown, string])[1])).not.toContain('host');
  });
});
