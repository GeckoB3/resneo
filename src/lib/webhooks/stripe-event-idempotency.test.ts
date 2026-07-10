import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  claimStripeWebhookEvent,
  markStripeWebhookEventProcessed,
  releaseStripeWebhookEvent,
} from '@/lib/webhooks/stripe-event-idempotency';

/**
 * Filter-aware-ish fake: select().eq().maybeSingle() returns the configured
 * existing row; update()...select() returns the configured reclaim result;
 * insert() returns the configured error; delete() records the call.
 */
function mockSupabase(handlers: {
  selectResult?: { data: unknown; error: unknown };
  insertError?: { code?: string } | null;
  reclaimResult?: { data: unknown; error: unknown };
  updateError?: unknown;
  deleteError?: unknown;
}) {
  const updateChain = () => {
    const chain: Record<string, unknown> = {};
    chain.eq = () => chain;
    chain.is = () => chain;
    chain.select = async () => ({
      data: handlers.reclaimResult?.data ?? null,
      error: handlers.reclaimResult?.error ?? null,
    });
    // Terminal await (mark-processed path: update().eq().is()).
    chain.then = (resolve: (v: unknown) => unknown) =>
      resolve({ error: handlers.updateError ?? null });
    return chain;
  };
  return {
    from: vi.fn((table: string) => {
      if (table !== 'webhook_events') throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: handlers.selectResult?.data ?? null,
              error: handlers.selectResult?.error ?? null,
            }),
          }),
        }),
        insert: async () => ({ error: handlers.insertError ?? null }),
        update: () => updateChain(),
        delete: () => ({
          eq: async () => ({ error: handlers.deleteError ?? null }),
        }),
      };
    }),
  } as unknown as SupabaseClient;
}

const STALE_ISO = new Date(Date.now() - 30 * 60 * 1000).toISOString();
const FRESH_ISO = new Date(Date.now() - 60 * 1000).toISOString();

describe('claimStripeWebhookEvent', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns already_processed when the row is completed', async () => {
    const admin = mockSupabase({
      selectResult: { data: { id: 'row-1', completed_at: FRESH_ISO, processed_at: FRESH_ISO }, error: null },
    });
    expect(await claimStripeWebhookEvent(admin, 'evt_1', 'payment_intent.succeeded')).toBe(
      'already_processed',
    );
  });

  it('returns concurrent for a fresh, uncompleted claim (another worker is live)', async () => {
    const admin = mockSupabase({
      selectResult: { data: { id: 'row-1', completed_at: null, processed_at: FRESH_ISO }, error: null },
    });
    expect(await claimStripeWebhookEvent(admin, 'evt_2', 'payment_intent.succeeded')).toBe(
      'concurrent',
    );
  });

  it('reclaims a stale, uncompleted claim (crashed worker) when the reclaim update wins', async () => {
    const admin = mockSupabase({
      selectResult: { data: { id: 'row-1', completed_at: null, processed_at: STALE_ISO }, error: null },
      reclaimResult: { data: [{ id: 'row-1' }], error: null },
    });
    expect(await claimStripeWebhookEvent(admin, 'evt_3', 'payment_intent.succeeded')).toBe(
      'claimed',
    );
  });

  it('returns concurrent when a stale claim is reclaimed by another worker first', async () => {
    const admin = mockSupabase({
      selectResult: { data: { id: 'row-1', completed_at: null, processed_at: STALE_ISO }, error: null },
      reclaimResult: { data: [], error: null },
    });
    expect(await claimStripeWebhookEvent(admin, 'evt_4', 'payment_intent.succeeded')).toBe(
      'concurrent',
    );
  });

  it('returns claimed when insert succeeds (no existing row)', async () => {
    const admin = mockSupabase({ selectResult: { data: null, error: null }, insertError: null });
    expect(await claimStripeWebhookEvent(admin, 'evt_5', 'payment_intent.succeeded')).toBe('claimed');
  });

  it('returns concurrent on unique violation', async () => {
    const admin = mockSupabase({
      selectResult: { data: null, error: null },
      insertError: { code: '23505' },
    });
    expect(await claimStripeWebhookEvent(admin, 'evt_6', 'payment_intent.succeeded')).toBe(
      'concurrent',
    );
  });

  it('throws on unexpected insert errors', async () => {
    const admin = mockSupabase({
      selectResult: { data: null, error: null },
      insertError: { code: 'XX000' },
    });
    await expect(
      claimStripeWebhookEvent(admin, 'evt_7', 'payment_intent.succeeded'),
    ).rejects.toEqual({ code: 'XX000' });
  });
});

describe('markStripeWebhookEventProcessed', () => {
  it('does not throw when the update succeeds', async () => {
    const admin = mockSupabase({});
    await expect(markStripeWebhookEventProcessed(admin, 'evt_mark')).resolves.toBeUndefined();
    expect(admin.from).toHaveBeenCalledWith('webhook_events');
  });

  it('swallows update errors (state already committed)', async () => {
    const admin = mockSupabase({ updateError: { code: 'XX000' } });
    await expect(markStripeWebhookEventProcessed(admin, 'evt_mark2')).resolves.toBeUndefined();
  });
});

describe('releaseStripeWebhookEvent', () => {
  it('deletes the webhook_events row for the event id', async () => {
    const admin = mockSupabase({});
    await releaseStripeWebhookEvent(admin, 'evt_release');
    expect(admin.from).toHaveBeenCalledWith('webhook_events');
  });
});
