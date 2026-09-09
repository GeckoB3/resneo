import { describe, expect, it } from 'vitest';
import {
  ownSiblingOverlapCount,
  visitChipLabel,
  visitSiblingIndex,
  visitTouchingEdges,
} from './visit-siblings';

const row = (id: string, over: Partial<Parameters<typeof visitSiblingIndex>[0][number]> = {}) => ({
  id,
  group_booking_id: 'g1',
  booking_date: '2026-09-09',
  booking_time: '10:00:00',
  status: 'Booked',
  ...over,
});

describe('visitSiblingIndex', () => {
  it('orders live services by date then time and numbers them', () => {
    const idx = visitSiblingIndex([
      row('b', { booking_time: '11:00:00' }),
      row('c', { booking_date: '2026-09-10', booking_time: '09:00:00' }),
      row('a', { booking_time: '10:00:00' }),
      row('x', { group_booking_id: null }),
    ]);
    expect(idx.get('a')).toEqual({ groupId: 'g1', index: 0, count: 3, anchorId: 'a' });
    expect(idx.get('b')?.index).toBe(1);
    expect(idx.get('c')?.index).toBe(2);
    expect(idx.has('x')).toBe(false);
    expect(visitChipLabel(idx.get('b')!)).toBe('2/3');
  });

  it('ignores parties, class carts, cancelled services and lone rows', () => {
    const idx = visitSiblingIndex([
      row('p1', { group_booking_id: 'party', person_label: 'Ann' }),
      row('p2', { group_booking_id: 'party', person_label: 'Bob' }),
      row('k1', { group_booking_id: 'cart', class_instance_id: 'ci' }),
      row('k2', { group_booking_id: 'cart', class_instance_id: 'ci' }),
      row('v1'),
      row('v2', { status: 'Cancelled' }),
    ]);
    expect(idx.size).toBe(0);
  });
});

describe('ownSiblingOverlapCount', () => {
  const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  const rows = [
    row('a', { booking_time: '10:00:00' }),
    row('b', { booking_time: '11:00:00' }),
    row('other', { group_booking_id: 'g2', booking_time: '11:00:00' }),
  ];
  const base = {
    rows,
    columnId: 'col-1',
    dateStr: '2026-09-09',
    columnIdOf: () => 'col-1',
    spanMinutesOf: () => 60,
    toMinutes,
  };

  it('counts only siblings of the moved service on the same column and day', () => {
    expect(ownSiblingOverlapCount({ ...base, moved: rows[0]!, startMin: 10 * 60 + 30, endMin: 11 * 60 + 30 })).toBe(1);
    expect(ownSiblingOverlapCount({ ...base, moved: rows[0]!, startMin: 12 * 60, endMin: 13 * 60 })).toBe(0);
    expect(ownSiblingOverlapCount({ ...base, moved: rows[0]!, startMin: 10 * 60 + 30, endMin: 11 * 60 + 30, dateStr: '2026-09-10' })).toBe(0);
    expect(ownSiblingOverlapCount({ ...base, moved: rows[0]!, startMin: 10 * 60 + 30, endMin: 11 * 60 + 30, columnId: 'col-2' })).toBe(0);
    expect(ownSiblingOverlapCount({ ...base, moved: rows[2]!, startMin: 10 * 60, endMin: 12 * 60 })).toBe(0);
  });
});

describe('visitTouchingEdges', () => {
  const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  const rows = [
    row('a', { booking_time: '10:00:00' }),
    row('b', { booking_time: '11:00:00' }),
    row('c', { booking_time: '12:30:00' }),
    row('other', { group_booking_id: 'g2', booking_time: '12:00:00' }),
  ];
  const base = {
    rows,
    columnIdOf: () => 'col-1',
    spanMinutesOf: () => 60,
    toMinutes,
  };

  it('marks the seam on both sides of two services that meet edge to edge', () => {
    expect(visitTouchingEdges({ ...base, row: rows[0]! })).toEqual({ top: false, bottom: true });
    expect(visitTouchingEdges({ ...base, row: rows[1]! })).toEqual({ top: true, bottom: false });
    // A gap before Toner: no seam, and a stranger's booking never counts.
    expect(visitTouchingEdges({ ...base, row: rows[2]! })).toEqual({ top: false, bottom: false });
  });

  it('needs the same column and day', () => {
    expect(visitTouchingEdges({ ...base, row: rows[0]!, columnIdOf: (r) => (r.id === 'b' ? 'col-2' : 'col-1') })).toEqual({
      top: false,
      bottom: false,
    });
    expect(
      visitTouchingEdges({ ...base, row: rows[0]!, rows: [rows[0]!, { ...rows[1]!, booking_date: '2026-09-10' }] }),
    ).toEqual({ top: false, bottom: false });
  });

  it('ignores a cancelled sibling', () => {
    expect(
      visitTouchingEdges({ ...base, row: rows[0]!, rows: [rows[0]!, { ...rows[1]!, status: 'Cancelled' }] }),
    ).toEqual({ top: false, bottom: false });
  });
});
