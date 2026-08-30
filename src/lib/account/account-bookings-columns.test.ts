/**
 * The projection guard.
 *
 * PostgREST returns exactly the columns asked for, so a field the row builder
 * maps but the SELECT omits arrives as `undefined`, and `?? null` turns that
 * into a plausible-looking null. Nothing throws, nothing logs, and the portal
 * quietly reports that an appointment had no service and nobody to see.
 *
 * That is what happened: P0-6 widened the view to carry `calendar_id` and
 * `service_item_id`, the DTO declared them with a comment explaining that
 * without them the portal cannot say what an appointment was or who it was
 * with, the builder mapped them, and the SELECT was never updated. It stayed
 * that way for months because every unit test in this directory stubs the
 * database and hands back whatever the test itself wrote.
 *
 * So this test does not stub anything. It reads the SELECT string.
 */
import { describe, it, expect } from 'vitest';
import { ACCOUNT_BOOKING_COLUMNS_FOR_TEST } from './account-bookings';

const COLUMNS = ACCOUNT_BOOKING_COLUMNS_FOR_TEST.split(',').map((c) => c.trim());

/**
 * Columns the portal cannot function without, each with the thing that breaks.
 * Add a row here when the DTO starts carrying a new column from the view.
 */
const REQUIRED: Array<[column: string, whatBreaks: string]> = [
  ['id', 'every link to a booking'],
  ['venue_id', 'which venue a booking belongs to'],
  ['guest_id', 'ownership'],
  ['booking_date', 'when it is'],
  ['booking_time', 'when it is'],
  ['status', 'whether it is cancelled'],
  ['booking_model', 'which kind of booking it is'],
  ['calendar_id', 'who an appointment is with, and rebooking with the same person'],
  ['service_item_id', 'what an appointment is for, and rebooking the same service'],
  ['deposit_status', 'whether a deposit is outstanding'],
  ['cancellation_deadline', 'whether it can still be cancelled'],
  ['group_booking_id', 'grouping a course into one card'],
  ['class_instance_id', 'class bookings'],
  ['experience_event_id', 'event bookings'],
  ['resource_id', 'resource bookings'],
];

describe('the account bookings projection', () => {
  for (const [column, whatBreaks] of REQUIRED) {
    it(`asks for ${column}, without which the portal loses ${whatBreaks}`, () => {
      expect(COLUMNS).toContain(column);
    });
  }

  it('asks for no column twice', () => {
    // A duplicate is harmless to PostgREST and a sign the list was edited
    // twice by people who could not tell what was already in it.
    expect(new Set(COLUMNS).size).toBe(COLUMNS.length);
  });

  it('is a plain column list, not a join or an embed', () => {
    /*
      `bookings_account_safe` is a view whose WHERE clause is the ownership
      predicate (AD8). A PostgREST embed here would read a related table
      through a path that predicate does not cover, so the shape is kept
      deliberately boring.
    */
    expect(ACCOUNT_BOOKING_COLUMNS_FOR_TEST).not.toMatch(/[(){}!*]/);
  });
});
