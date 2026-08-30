import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeRecordingDb } from '@/lib/testing/recording-supabase';

const hoisted = vi.hoisted(() => ({
  db: null as ReturnType<typeof makeRecordingDb> | null,
  /** Force the insert to fail, to prove emitters stay silent. */
  insertError: null as { code: string; message: string } | null,
  /** Force getSupabaseAdminClient itself to throw. */
  clientThrows: false,
}));

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdminClient: () => {
    if (hoisted.clientThrows) throw new Error('no admin client');
    return hoisted.db!.db;
  },
}));

import {
  recordPortalEntry,
  recordPortalSignInCompleted,
  recordPortalTokenVerifyFailed,
  recordPortalBookingAction,
  PORTAL_EVENT_TYPES,
} from './portal-events';
import {
  getPortalCompletionRate,
  getInPortalActionShare,
  getPortalTokenVerifyFailureCount,
} from './portal-metrics';

describe('portal event emitters', () => {
  beforeEach(() => {
    hoisted.insertError = null;
    hoisted.clientThrows = false;
    hoisted.db = makeRecordingDb((call) =>
      call.op === 'insert' && hoisted.insertError
        ? { data: null, error: hoisted.insertError }
        : { data: null, error: null },
    );
  });

  it('writes the entry event with its route', async () => {
    await recordPortalEntry({ route: 'one_click_token', userId: 'u1', venueId: 'v1' });
    expect(hoisted.db!.calls[0]).toMatchObject({
      table: 'portal_events',
      op: 'insert',
      payload: {
        event_type: 'portal_entry',
        user_id: 'u1',
        venue_id: 'v1',
        payload: { route: 'one_click_token' },
      },
    });
  });

  it('allows a null user and venue, because a failed entry has neither', async () => {
    await recordPortalTokenVerifyFailed({ reason: 'expired' });
    expect(hoisted.db!.calls[0].payload).toMatchObject({
      event_type: 'portal_token_verify_failed',
      user_id: null,
      venue_id: null,
      payload: { reason: 'expired' },
    });
  });

  it('tags a booking action with its surface', async () => {
    await recordPortalBookingAction({
      action: 'cancelled',
      surface: 'token_link',
      bookingId: 'b1',
      userId: 'u1',
    });
    expect(hoisted.db!.calls[0].payload).toMatchObject({
      event_type: 'portal_booking_cancelled',
      payload: { surface: 'token_link', booking_id: 'b1' },
    });
  });

  it('is FAIL-SOFT: a database error never propagates', async () => {
    // The guarantee that lets callers omit try/catch. A customer must never
    // see a 500 because an analytics insert failed.
    hoisted.insertError = { code: '23505', message: 'boom' };
    await expect(
      recordPortalSignInCompleted({ userId: 'u1' }),
    ).resolves.toBeUndefined();
  });

  it('is FAIL-SOFT even when the admin client itself throws', async () => {
    hoisted.clientThrows = true;
    await expect(recordPortalEntry({ route: 'magic_link' })).resolves.toBeUndefined();
  });

  it('reserves portal_token_verify_failed before anything emits it', () => {
    // §5A reads a revert threshold off this name, so it is fixed now rather
    // than invented during P3-4a.
    expect(PORTAL_EVENT_TYPES).toContain('portal_token_verify_failed');
  });
});

describe('portal metric read queries', () => {
  const range = { from: '2026-06-01T00:00:00.000Z', to: '2026-07-01T00:00:00.000Z' };

  it('computes the completion rate and splits entries by route', async () => {
    hoisted.db = makeRecordingDb(() => ({
      data: [
        { event_type: 'portal_entry', payload: { route: 'one_click_token' } },
        { event_type: 'portal_entry', payload: { route: 'magic_link' } },
        { event_type: 'portal_entry', payload: { route: 'magic_link' } },
        { event_type: 'portal_entry', payload: {} },
        { event_type: 'portal_signin_completed', payload: {} },
        { event_type: 'portal_signin_completed', payload: {} },
      ],
    }));
    const result = await getPortalCompletionRate(range);
    expect(result).toMatchObject({ entries: 4, completions: 2, rate: 0.5 });
    expect(result.entriesByRoute).toMatchObject({
      one_click_token: 1,
      magic_link: 2,
      direct_sign_in: 0,
      unknown: 1,
    });
  });

  it('returns a null rate rather than dividing by zero', async () => {
    hoisted.db = makeRecordingDb(() => ({ data: [] }));
    expect((await getPortalCompletionRate(range)).rate).toBeNull();
  });

  it('computes the in-portal share of cancels', async () => {
    hoisted.db = makeRecordingDb(() => ({
      data: [
        { payload: { surface: 'portal' } },
        { payload: { surface: 'portal' } },
        { payload: { surface: 'portal' } },
        { payload: { surface: 'token_link' } },
      ],
    }));
    const result = await getInPortalActionShare(range, 'cancelled');
    expect(result).toMatchObject({ action: 'cancelled', inPortal: 3, onTokenLink: 1, total: 4, share: 0.75 });
  });

  it('THROWS on a read error rather than reporting zero', async () => {
    // The opposite policy to the emitters, deliberately: a metric that
    // silently returns zero during an incident reads as "nothing is wrong".
    hoisted.db = makeRecordingDb(() => ({ data: null, error: { code: '42501', message: 'denied' } }));
    await expect(getPortalCompletionRate(range)).rejects.toThrow(/completion rate failed/);
    await expect(getInPortalActionShare(range, 'rescheduled')).rejects.toThrow(/rescheduled share failed/);
  });

  it('returns 0 token failures before P3-4a wires the emitter', async () => {
    hoisted.db = makeRecordingDb(() => ({ data: null, count: 0 }));
    expect(await getPortalTokenVerifyFailureCount(range)).toBe(0);
  });
});
