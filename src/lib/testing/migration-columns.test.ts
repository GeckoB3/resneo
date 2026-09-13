import { describe, expect, it } from 'vitest';
import type { RecordedCall } from './recording-supabase';
import { columnsMissingFromMigrations, tableColumnsFromMigrations } from './migration-columns';

const read = (table: string, columns: string, filters: RecordedCall['filters'] = []): RecordedCall => ({
  table,
  op: 'select',
  columns,
  filters,
});

describe('tableColumnsFromMigrations', () => {
  it('follows CREATE TABLE through later ADD and DROP COLUMN', () => {
    const guests = tableColumnsFromMigrations('guests');
    expect(guests.has('venue_id')).toBe(true); // CREATE TABLE
    expect(guests.has('tags')).toBe(true); // 20260428180000_guest_tags
    expect(guests.has('first_name')).toBe(true); // 20260810120000_guest_first_last_names
    expect(guests.has('last_name')).toBe(true);
    expect(guests.has('name')).toBe(false); // dropped by the same migration
  });
});

describe('columnsMissingFromMigrations', () => {
  it.each([
    ['a projection', read('guests', 'id, name, email')],
    ['an embed written across lines', read('bookings', 'id,\n  guests (\n    name,\n    email\n  )')],
    ['an order', read('guests', 'id, email', [['order', 'name', { ascending: true }]])],
    ['a filter on an embedded column', read('bookings', 'id', [['eq', 'guests.name', 'Ann']])],
  ])('flags guests.name in %s', (_where, call) => {
    expect(columnsMissingFromMigrations([call])).toEqual(['guests.name']);
  });

  it('reads aliases, casts, hints and JSON paths as the column they name, and skips rpc', () => {
    expect(
      columnsMissingFromMigrations([
        read('bookings', 'ref:id, booking_date::text, client:guests!inner ( first_name, custom_fields->>allergy )', [
          ['eq', 'venue_id', 'v1'],
          ['not', 'guest_id', 'is', null],
          ['order', 'booking_date', { ascending: false }],
          ['limit', 50],
        ]),
        { table: 'rpc:report_frequent_visitors', op: 'rpc', payload: {}, filters: [['order', 'visit_count']] },
      ]),
    ).toEqual([]);
  });
});
