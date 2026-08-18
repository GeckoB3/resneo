import { describe, it, expect } from 'vitest';
import {
  attachVenueClockToAppointmentInput,
  type AppointmentEngineInput,
} from '@/lib/availability/appointment-engine';
import { block } from '@/lib/availability/parity/scheduling-world';

/**
 * SA-L1 (plan §1.2 item 4, Stage 1 item 2): the legacy `venues.venue_opening_exceptions`
 * JSON is a fallback, never an override.
 *
 * The defect was a precedence bug in one function, not a plumbing gap across fifteen call
 * sites. All three fetchers already derive `venueWideBlocks` from
 * `availability_blocks`; this helper then overwrote that whenever the legacy JSON happened
 * to parse non-empty. Fourteen of the fifteen call sites pass no `venueBlocks`, so at any
 * venue carrying legacy JSON the closures table lost to a column nothing writes.
 *
 * Production carries none today (query Q9, 2026-08-17: zero rows), so this is latent
 * rather than live -- but it is one column write away from being live.
 */

const VENUE = { timezone: 'Europe/London', opening_hours: null };

function baseInput(over: Partial<AppointmentEngineInput> = {}): AppointmentEngineInput {
  return {
    date: '2030-06-05',
    practitioners: [],
    services: [],
    practitionerServices: [],
    existingBookings: [],
    ...over,
  };
}

const LEGACY_JSON = [{ id: 'legacy-1', date_start: '2030-06-05', date_end: '2030-06-05', closed: true }];

describe('attachVenueClockToAppointmentInput exception precedence (SA-L1)', () => {
  it('keeps a fetcher-derived list instead of replacing it with legacy JSON', () => {
    const derived = [
      block({ id: 'from-blocks', block_type: 'amended_hours', override_periods: [{ open: '10:00', close: '14:00' }] }),
    ];
    const input = baseInput({ venueWideBlocks: derived });

    attachVenueClockToAppointmentInput(input, { ...VENUE, venue_opening_exceptions: LEGACY_JSON });

    expect(input.venueWideBlocks).toEqual(derived);
  });

  it('still fills from legacy JSON when the caller genuinely has nothing', () => {
    const input = baseInput();

    attachVenueClockToAppointmentInput(input, { ...VENUE, venue_opening_exceptions: LEGACY_JSON });

    expect(input.venueWideBlocks).toHaveLength(1);
    expect(input.venueWideBlocks?.[0]?.id).toBe('legacy-1');
  });

  it('does not let legacy JSON revive an empty derived list, which means "no closures"', () => {
    const input = baseInput({ venueWideBlocks: [] });

    attachVenueClockToAppointmentInput(input, { ...VENUE, venue_opening_exceptions: LEGACY_JSON });

    expect(input.venueWideBlocks).toEqual([]);
  });

  it('prefers explicitly passed venueBlocks over both', () => {
    const input = baseInput({ venueWideBlocks: [] });
    const blocks = [
      block({ block_type: 'closed', date_start: '2030-06-05', date_end: '2030-06-05', id: 'blk-1' }),
    ];

    attachVenueClockToAppointmentInput(input, { ...VENUE, venue_opening_exceptions: LEGACY_JSON }, null, blocks);

    expect(input.venueWideBlocks?.map((e) => e.id)).toEqual(['blk-1']);
  });

  it('treats an empty venueBlocks array as an authoritative "no closures"', () => {
    const input = baseInput();

    attachVenueClockToAppointmentInput(input, { ...VENUE, venue_opening_exceptions: LEGACY_JSON }, null, []);

    expect(input.venueWideBlocks).toEqual([]);
  });

  it('leaves the field untouched when the venue row carries no legacy column at all', () => {
    const input = baseInput();

    attachVenueClockToAppointmentInput(input, VENUE);

    expect(input.venueWideBlocks).toBeUndefined();
  });
});
