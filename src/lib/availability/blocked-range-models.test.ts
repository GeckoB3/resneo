import { describe, it, expect, vi } from 'vitest';
import {
  ALL_MODEL_OWNED_BLOCK_SOURCES,
  blockSourcesFromVenueRow,
  fetchModelOwnedBlockSources,
  modelOwnedBlockSources,
} from './blocked-range-models';

describe('modelOwnedBlockSources', () => {
  it('enables each source only when its model is active', () => {
    expect(modelOwnedBlockSources(['unified_scheduling', 'resource_booking'])).toEqual({
      resources: true,
      classes: false,
      events: false,
    });
    expect(modelOwnedBlockSources(['unified_scheduling', 'class_session', 'event_ticket'])).toEqual({
      resources: false,
      classes: true,
      events: true,
    });
  });

  it('blocks nothing model-owned for an appointments-only venue', () => {
    expect(modelOwnedBlockSources(['unified_scheduling'])).toEqual({
      resources: false,
      classes: false,
      events: false,
    });
  });
});

describe('blockSourcesFromVenueRow', () => {
  it('reads an explicit active_booking_models list', () => {
    const sources = blockSourcesFromVenueRow({
      pricing_tier: 'plus',
      booking_model: 'unified_scheduling',
      enabled_models: null,
      active_booking_models: ['unified_scheduling', 'class_session'],
    });

    expect(sources).toEqual({ resources: false, classes: true, events: false });
  });

  /** An appointments venue that never picked secondary models blocks nothing model-owned. */
  it('defaults an appointments-plan venue to unified scheduling alone', () => {
    expect(
      blockSourcesFromVenueRow({
        pricing_tier: 'plus',
        booking_model: 'unified_scheduling',
        enabled_models: null,
        active_booking_models: null,
      }),
    ).toEqual({ resources: false, classes: false, events: false });
  });

  it('stops a removed model blocking once it leaves the list', () => {
    const withResources = blockSourcesFromVenueRow({
      pricing_tier: 'plus',
      booking_model: 'unified_scheduling',
      active_booking_models: ['unified_scheduling', 'resource_booking'],
    });
    const withoutResources = blockSourcesFromVenueRow({
      pricing_tier: 'plus',
      booking_model: 'unified_scheduling',
      active_booking_models: ['unified_scheduling'],
    });

    expect(withResources.resources).toBe(true);
    expect(withoutResources.resources).toBe(false);
  });

  it('falls back to the legacy enabled_models column when active_booking_models is unset', () => {
    const sources = blockSourcesFromVenueRow({
      pricing_tier: 'plus',
      booking_model: 'unified_scheduling',
      enabled_models: ['event_ticket'],
      active_booking_models: null,
    });

    expect(sources).toEqual({ resources: false, classes: false, events: true });
  });

  /**
   * The read failing must not quietly unblock occupied time. Refusing a booking that should
   * have been allowed is visible and recoverable; accepting one onto a held window is not.
   */
  it('keeps every source blocking when the venue row is missing', () => {
    expect(blockSourcesFromVenueRow(null)).toEqual(ALL_MODEL_OWNED_BLOCK_SOURCES);
    expect(blockSourcesFromVenueRow(undefined)).toEqual(ALL_MODEL_OWNED_BLOCK_SOURCES);
  });

  it('returns a fresh object so callers cannot mutate the shared fallback', () => {
    const sources = blockSourcesFromVenueRow(null);
    sources.resources = false;
    expect(ALL_MODEL_OWNED_BLOCK_SOURCES.resources).toBe(true);
  });
});

describe('fetchModelOwnedBlockSources', () => {
  function makeSupabase(result: { data: unknown; error: { message: string } | null }) {
    const chain: Record<string, unknown> = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      maybeSingle: vi.fn(() => Promise.resolve(result)),
    };
    return {
      from: vi.fn(() => chain),
    } as unknown as Parameters<typeof fetchModelOwnedBlockSources>[0];
  }

  it('resolves from the venue row', async () => {
    const supabase = makeSupabase({
      data: {
        pricing_tier: 'plus',
        booking_model: 'unified_scheduling',
        active_booking_models: ['unified_scheduling', 'resource_booking'],
      },
      error: null,
    });

    await expect(fetchModelOwnedBlockSources(supabase, 'v1')).resolves.toEqual({
      resources: true,
      classes: false,
      events: false,
    });
  });

  it('keeps every source blocking when the query errors', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const supabase = makeSupabase({ data: null, error: { message: 'boom' } });

    await expect(fetchModelOwnedBlockSources(supabase, 'v1')).resolves.toEqual(
      ALL_MODEL_OWNED_BLOCK_SOURCES,
    );
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
