/**
 * Same-named services (Docs/link-and-collective-setup-wizard-plan.md, L13): which members an offer
 * will ask, and which offerings a venue has still to answer about.
 */
import { describe, expect, it } from 'vitest';
import { makeRecordingDb } from '@/lib/testing/recording-supabase';
import { loadPendingAdoptionsByVenue, loadSameNameMatches } from './adoptions';

const HOST = '11111111-1111-4111-8111-111111111111';
const BLOOM = '22222222-2222-4222-8222-222222222222';
const CEDAR = '33333333-3333-4333-8333-333333333333';
const COLLECTIVE = '44444444-4444-4444-8444-444444444444';

describe('loadSameNameMatches', () => {
  it('matches trimmed, case-insensitive names at members, skipping services that already follow an offering', async () => {
    const recording = makeRecordingDb((call) => {
      if (call.table === 'venue_collective_members') {
        return { data: [{ venue_id: BLOOM, venues: { name: 'Bloom' } }, { venue_id: CEDAR, venues: { name: 'Cedar' } }] };
      }
      if (call.table === 'service_items') {
        const forHost = call.filters.some((f) => f[0] === 'eq' && f[1] === 'venue_id');
        return forHost
          ? { data: [{ id: 'h-cut', name: 'Cut and Finish' }, { id: 'h-colour', name: 'Colour' }] }
          : {
              data: [
                { id: 'b-cut', name: '  cut and finish ', venue_id: BLOOM },
                { id: 'c-cut', name: 'Cut and Finish', venue_id: CEDAR },
                { id: 'b-colour', name: 'Colour', venue_id: BLOOM },
              ],
            };
      }
      if (call.table === 'collective_service_replicas') return { data: [{ replica_service_id: 'b-colour' }] };
      return undefined;
    });
    const matches = await loadSameNameMatches(recording.db, COLLECTIVE, HOST);
    expect(matches).toEqual({
      'h-cut': [
        { venue_id: BLOOM, venue_name: 'Bloom', service_id: 'b-cut' },
        { venue_id: CEDAR, venue_name: 'Cedar', service_id: 'c-cut' },
      ],
    });
  });

  it('is empty with no members, and reads nothing else', async () => {
    const recording = makeRecordingDb(() => ({ data: [] }));
    expect(await loadSameNameMatches(recording.db, COLLECTIVE, HOST)).toEqual({});
    expect(recording.queryCount({ table: 'service_items' })).toBe(0);
  });
});

describe('loadPendingAdoptionsByVenue', () => {
  it('keeps a question open until an answer follows it', async () => {
    const recording = makeRecordingDb((call) => {
      if (call.table === 'collective_audit_events') {
        return {
          data: [
            { event_type: 'adoption_requested', item_id: 'i-1', target_venue_id: BLOOM, created_at: '2026-09-19T10:00:00Z' },
            { event_type: 'adoption_requested', item_id: 'i-2', target_venue_id: BLOOM, created_at: '2026-09-19T10:01:00Z' },
            { event_type: 'adoption_answered', item_id: 'i-1', target_venue_id: BLOOM, created_at: '2026-09-19T10:05:00Z' },
            { event_type: 'adoption_requested', item_id: 'i-1', target_venue_id: CEDAR, created_at: '2026-09-19T10:06:00Z' },
          ],
        };
      }
      return undefined;
    });
    const open = await loadPendingAdoptionsByVenue(recording.db, COLLECTIVE);
    expect([...(open.get(BLOOM) ?? [])]).toEqual(['i-2']);
    expect([...(open.get(CEDAR) ?? [])]).toEqual(['i-1']);
  });
});
