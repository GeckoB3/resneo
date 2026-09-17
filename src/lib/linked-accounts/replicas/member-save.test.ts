/**
 * What a member may change about a service its host manages (plan Appendix E contract 4, member
 * half; W6).
 *
 * The guard exists so a member reads a sentence instead of a database refusal, and so the saves it
 * is entitled to make are not caught by it. The case that matters most is the old app build that
 * sends the whole service back to change one calendar: re-sending values that have not changed is
 * not a change, and must go through.
 */
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeRecordingDb, type Responder } from '@/lib/testing/recording-supabase';
import { hostOwnedFieldsInSave, loadMemberServiceContext } from './member-save';

const row = {
  id: 'svc-1',
  name: 'Facial',
  description: null,
  price_pence: 6000,
  deposit_pence: null,
  duration_minutes: 60,
  online_meeting_url: null,
  online_meeting_info: null,
  booking_start_times: null,
};

describe('hostOwnedFieldsInSave', () => {
  it('lets a calendar-only save through', () => {
    expect(hostOwnedFieldsInSave({ id: 'svc-1', practitioner_ids: ['cal-1'] }, row)).toEqual([]);
  });

  it("lets the member set its own joining details", () => {
    expect(
      hostOwnedFieldsInSave({ online_meeting_url: 'https://meet.example/abc', online_meeting_info: 'Ring the bell' }, row),
    ).toEqual([]);
  });

  it('names the fields the host owns', () => {
    expect(hostOwnedFieldsInSave({ price_pence: 7000, name: 'My name for it' }, row).sort()).toEqual([
      'name',
      'price_pence',
    ]);
  });

  it('lets an old build re-send the whole service to change one calendar', () => {
    expect(
      hostOwnedFieldsInSave(
        {
          id: 'svc-1',
          practitioner_ids: ['cal-1', 'cal-2'],
          name: 'Facial',
          price_pence: 6000,
          duration_minutes: 60,
          // The API sends '' for an empty text field; the row holds null.
          description: '',
          deposit_pence: 0,
          booking_start_times: null,
        },
        row,
      ),
    ).toEqual([]);
  });

  it('still catches a real edit hidden in a whole-service save', () => {
    expect(
      hostOwnedFieldsInSave({ id: 'svc-1', name: 'Facial', price_pence: 9900, duration_minutes: 60 }, row),
    ).toEqual(['price_pence']);
  });

  it('ignores the stale checks, which are not fields of the service', () => {
    expect(
      hostOwnedFieldsInSave(
        { id: 'svc-1', expected_updated_at: '2026-09-16T09:00:00Z', expected_calendar_ids: ['cal-1'] },
        row,
      ),
    ).toEqual([]);
  });
});

const world = (overrides: Responder = () => undefined): Responder => (call) => {
  const injected = overrides(call);
  if (injected) return injected;
  if (call.table === 'collective_service_replicas') {
    return {
      data: { id: 'link-1', collective_id: 'collective-1', collective_service_item_id: 'item-1', venue_id: 'member' },
    };
  }
  if (call.table === 'venue_collectives') {
    return {
      data: {
        id: 'collective-1',
        name: 'Northside',
        status: 'active',
        service_model: 'replicas',
        host_venue_id: 'host',
        venues: { name: 'Host Venue' },
      },
    };
  }
  if (call.table === 'collective_service_items') return { data: { status: 'active' } };
  return undefined;
};

describe('loadMemberServiceContext', () => {
  it('names the host and the collective for the refusal to read with', async () => {
    const recording = makeRecordingDb(world());
    expect(await loadMemberServiceContext(recording.db as unknown as SupabaseClient, 'svc-1', 'member')).toEqual({
      collectiveId: 'collective-1',
      collectiveName: 'Northside',
      hostVenueName: 'Host Venue',
      role: 'replica',
    });
  });

  it('calls a copy retired once the host has taken it off the page', async () => {
    const recording = makeRecordingDb(world((call) =>
      call.table === 'collective_service_items' ? { data: { status: 'retired' } } : undefined,
    ));
    const context = await loadMemberServiceContext(recording.db as unknown as SupabaseClient, 'svc-1', 'member');
    expect(context?.role).toBe('retired');
  });

  it('is nothing for a venue\'s own service', async () => {
    const recording = makeRecordingDb();
    expect(await loadMemberServiceContext(recording.db as unknown as SupabaseClient, 'svc-1', 'member')).toBeNull();
  });

  it('is nothing once the collective has ended', async () => {
    const recording = makeRecordingDb(world((call) =>
      call.table === 'venue_collectives'
        ? { data: { id: 'collective-1', name: 'Northside', status: 'dissolved', service_model: 'replicas', host_venue_id: 'host' } }
        : undefined,
    ));
    expect(await loadMemberServiceContext(recording.db as unknown as SupabaseClient, 'svc-1', 'member')).toBeNull();
  });
});
