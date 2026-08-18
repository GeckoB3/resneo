import { describe, it, expect } from 'vitest';
import { venueOpeningExceptionsToBlocks } from './venue-exceptions-adapter';

/**
 * Stage 3 reversed this adapter.
 *
 * It used to convert `availability_blocks` DOWN into the legacy `VenueOpeningException`
 * shape so the appointment engine could keep its own minute-range logic. That direction was
 * lossy in exactly the two ways the resolver plan calls defects: it discarded
 * `time_start`/`time_end` on a closure, so a part-day closure removed the whole appointment
 * day, and it dropped an amended row with no periods, so one row meant "open" to
 * appointments and "shut" to everything else.
 *
 * Every consumer now resolves through `resolveVenueWideAllowedMinuteRanges`, so the legacy
 * JSON is converted UP to the canonical shape instead and there is one resolution path.
 */
describe('venueOpeningExceptionsToBlocks', () => {
  it('returns nothing for an absent or empty list', () => {
    expect(venueOpeningExceptionsToBlocks(null, 'v1')).toEqual([]);
    expect(venueOpeningExceptionsToBlocks(undefined, 'v1')).toEqual([]);
    expect(venueOpeningExceptionsToBlocks([], 'v1')).toEqual([]);
  });

  it('maps a closed exception to a whole-day closure block', () => {
    const [b] = venueOpeningExceptionsToBlocks(
      [{ id: 'e1', date_start: '2030-06-05', date_end: '2030-06-05', closed: true, reason: 'Bank holiday' }],
      'v1',
    );

    expect(b).toMatchObject({
      id: 'e1',
      venue_id: 'v1',
      service_id: null,
      block_type: 'closed',
      date_start: '2030-06-05',
      date_end: '2030-06-05',
      reason: 'Bank holiday',
      override_periods: null,
    });
    // The legacy shape never had a part-day closure, so the window stays whole-day.
    expect(b!.time_start).toBeNull();
    expect(b!.time_end).toBeNull();
  });

  it('maps an open exception with periods to an amended-hours block', () => {
    const [b] = venueOpeningExceptionsToBlocks(
      [
        {
          id: 'e2',
          date_start: '2030-06-05',
          date_end: '2030-06-07',
          closed: false,
          periods: [{ open: '10:00', close: '14:00' }],
        },
      ],
      'v1',
    );

    expect(b).toMatchObject({
      block_type: 'amended_hours',
      date_start: '2030-06-05',
      date_end: '2030-06-07',
      override_periods: [{ open: '10:00', close: '14:00' }],
    });
  });

  it('gives every row an id, so a list with none still resolves deterministically', () => {
    const blocks = venueOpeningExceptionsToBlocks(
      [
        { date_start: '2030-06-05', date_end: '2030-06-05', closed: true },
        { date_start: '2030-06-06', date_end: '2030-06-06', closed: true },
      ] as never,
      'v1',
    );

    expect(blocks.map((b) => b.id)).toEqual(['legacy-0', 'legacy-1']);
  });
});
