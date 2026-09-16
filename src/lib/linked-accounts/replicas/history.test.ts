/**
 * A collective's history, as its venues read it (plan contract 3).
 *
 * The history is the record a host and a member would use to settle who changed what, so the
 * guards are: every row reads as a plain sentence, a member never sees what happened at another
 * member, and the filters that are built from strings accept nothing but ids and timestamps.
 */
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeRecordingDb, type Responder } from '@/lib/testing/recording-supabase';
import {
  changedFieldWords,
  historyCsv,
  historySentence,
  loadHistory,
  type HistoryNames,
  type HistoryRow,
} from './history';

const HOST = '11111111-1111-4111-8111-111111111111';
const MEMBER = '22222222-2222-4222-8222-222222222222';
const COLLECTIVE = '33333333-3333-4333-8333-333333333333';

const row = (overrides: Partial<HistoryRow> = {}): HistoryRow => ({
  id: '44444444-4444-4444-8444-444444444444',
  created_at: '2026-09-16T09:00:00.000Z',
  event_type: 'offering_added',
  collective_name: 'Northside',
  actor_type: 'venue_user',
  actor_venue_id: HOST,
  actor_venue_name: 'Host Venue',
  actor_user_id: 'user-1',
  system_job: null,
  target_venue_id: null,
  target_venue_name: null,
  service_id: 'svc-1',
  calendar_id: null,
  changes: null,
  ...overrides,
});

const names: HistoryNames = {
  service: (id) => (id === 'svc-1' ? 'Facial' : 'a service'),
  calendar: (id) => (id === 'cal-1' ? 'Chair 2' : 'a calendar'),
  person: (venueId, userId) => (venueId === HOST && userId === 'user-1' ? 'Sam' : null),
};

describe('historySentence', () => {
  it('names the person and the venue that acted', () => {
    expect(historySentence(row(), names)).toBe('Sam at Host Venue added Facial to the page');
  });

  it('falls back to the venue when no person is known', () => {
    expect(historySentence(row({ actor_user_id: null }), names)).toBe('Host Venue added Facial to the page');
  });

  it("calls the system's own work ResNeo", () => {
    expect(
      historySentence(
        row({ event_type: 'replica_applied', actor_type: 'system', target_venue_name: 'Zen Studio' }),
        names,
      ),
    ).toBe('Facial updated at Zen Studio');
    expect(historySentence(row({ event_type: 'master_changed', actor_type: 'system' }), names)).toContain(
      'ResNeo changed Facial',
    );
  });

  it('says which calendar at which venue', () => {
    expect(
      historySentence(
        row({ event_type: 'calendar_assigned', calendar_id: 'cal-1', target_venue_name: 'Zen Studio' }),
        names,
      ),
    ).toBe('Sam at Host Venue added Chair 2 at Zen Studio to Facial');
  });

  it('reads the membership events', () => {
    expect(historySentence(row({ event_type: 'member_joined', target_venue_name: 'Zen Studio' }), names)).toBe(
      'Zen Studio joined',
    );
    expect(historySentence(row({ event_type: 'collective_dissolved' }), names)).toBe(
      'Sam at Host Venue ended Northside',
    );
  });

  it('reads a request to use a page address, and its answers', () => {
    const at = { target_venue_name: 'Zen Studio', service_id: null };
    expect(historySentence(row({ event_type: 'address_adoption_requested', ...at }), names)).toBe(
      "Sam at Host Venue asked to use Zen Studio's page address for Northside",
    );
    expect(
      historySentence(
        row({ event_type: 'address_adopted', ...at, changes: { after: { address: '/book/zen' } } }),
        names,
      ),
    ).toBe('Zen Studio agreed that the Northside page uses its page address, /book/zen');
    expect(historySentence(row({ event_type: 'address_adoption_declined', ...at }), names)).toBe(
      'Zen Studio kept its page address for now',
    );
  });

  it('still says something for an event it has no sentence for', () => {
    expect(historySentence(row({ event_type: 'photo_copied' }), names)).toBe(
      'Sam at Host Venue made a change to Northside',
    );
  });
});

describe('changedFieldWords', () => {
  it('names what changed, in the words a venue uses', () => {
    expect(
      changedFieldWords({
        before: { service: { price_pence: 6000, duration_minutes: 60, name: 'Facial' } },
        after: { service: { price_pence: 6500, duration_minutes: 45, name: 'Facial' } },
      }),
    ).toBe('price and length');
  });

  it('says "its settings" when nothing it knows about moved', () => {
    expect(changedFieldWords(null)).toBe('its settings');
  });
});

describe('historyCsv', () => {
  it('writes one row per change and never lets a cell run as a formula', () => {
    const csv = historyCsv([
      {
        id: 'e1',
        at: '2026-09-16T09:00:00.000Z',
        type: 'offering_added',
        sentence: '=HYPERLINK("x") added Facial',
        actor: { venue_name: 'Host, Venue', person: 'Sam' },
        changes: null,
      },
    ]);
    const [header, line] = csv.trim().split('\n');
    expect(header).toBe('When,What happened,Venue,Person');
    expect(line).toContain(`"'=HYPERLINK(""x"") added Facial"`);
    expect(line).toContain('"Host, Venue"');
  });
});

describe('loadHistory', () => {
  const load = (responder: Responder, overrides: Partial<Parameters<typeof loadHistory>[1]> = {}) => {
    const recording = makeRecordingDb(responder);
    return {
      recording,
      page: loadHistory(recording.db as unknown as SupabaseClient, {
        collectiveId: COLLECTIVE,
        viewerVenueId: MEMBER,
        isHost: false,
        ...overrides,
      }),
    };
  };
  const rows: Responder = (call) =>
    call.table === 'collective_audit_events' ? { data: [row(), row({ id: '55555555-5555-4555-8555-555555555555' })] } : undefined;

  it('shows a member only what was done to it or to everyone', async () => {
    const { recording, page } = load(rows);
    await page;
    const read = recording.calls.find((c) => c.table === 'collective_audit_events')!;
    expect(read.filters).toContainEqual(['or', `target_venue_id.eq.${MEMBER},target_venue_id.is.null`]);
  });

  it('shows the host everything', async () => {
    const { recording, page } = load(rows, { isHost: true, viewerVenueId: HOST });
    await page;
    const read = recording.calls.find((c) => c.table === 'collective_audit_events')!;
    expect(read.filters.some((f) => f[0] === 'or')).toBe(false);
  });

  it('pages with a cursor when there is more', async () => {
    const { page } = load(rows, { isHost: true, limit: 1 });
    const result = await page;
    expect(result.events).toHaveLength(1);
    expect(result.next_cursor).toBe('2026-09-16T09:00:00.000Z|44444444-4444-4444-8444-444444444444');
  });

  it('ignores a venue filter or a cursor that is not exactly an id and a time', async () => {
    const { recording, page } = load(rows, {
      isHost: true,
      venueId: 'x),created_at.gt.2000-01-01',
      cursor: 'now|not-an-id',
    });
    await page;
    const read = recording.calls.find((c) => c.table === 'collective_audit_events')!;
    expect(read.filters.some((f) => f[0] === 'or')).toBe(false);
  });

  it('reads the names it needs in one go', async () => {
    const { recording, page } = load((call) => {
      if (call.table === 'collective_audit_events') return { data: [row()] };
      if (call.table === 'service_items') return { data: [{ id: 'svc-1', name: 'Facial' }] };
      if (call.table === 'staff') return { data: [{ user_id: 'user-1', venue_id: HOST, name: 'Sam' }] };
      return undefined;
    }, { isHost: true });
    const result = await page;
    expect(result.events[0]!.sentence).toBe('Sam at Host Venue added Facial to the page');
    expect(result.events[0]!.actor).toEqual({ venue_name: 'Host Venue', person: 'Sam' });
    expect(recording.calls.filter((c) => c.table === 'service_items')).toHaveLength(1);
  });
});
