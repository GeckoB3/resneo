import { describe, expect, it } from 'vitest';
import { groupInfoRows, pickInfoRowCount, pickVisibleInfoRows } from './BookingCardInfo';

describe('pickInfoRowCount', () => {
  it('returns 1 below 48px height', () => {
    expect(pickInfoRowCount(0, 5)).toBe(1);
    expect(pickInfoRowCount(27, 5)).toBe(1);
    expect(pickInfoRowCount(47, 5)).toBe(1);
  });

  it('returns 2 from 48px up to below 66px', () => {
    expect(pickInfoRowCount(48, 5)).toBe(2);
    expect(pickInfoRowCount(65, 5)).toBe(2);
  });

  it('returns 3 from 66px up to below 88px', () => {
    expect(pickInfoRowCount(66, 5)).toBe(3);
    expect(pickInfoRowCount(87, 5)).toBe(3);
  });

  it('returns 4 from 88px up to below 108px', () => {
    expect(pickInfoRowCount(88, 5)).toBe(4);
    expect(pickInfoRowCount(107, 5)).toBe(4);
  });

  it('returns 5 at 108px and above', () => {
    expect(pickInfoRowCount(108, 5)).toBe(5);
    expect(pickInfoRowCount(400, 5)).toBe(5);
  });

  it('caps at itemCount 4 for segment layout', () => {
    expect(pickInfoRowCount(400, 4)).toBe(4);
    expect(pickInfoRowCount(112, 4)).toBe(4);
    expect(pickInfoRowCount(88, 4)).toBe(4);
    expect(pickInfoRowCount(66, 4)).toBe(3);
    expect(pickInfoRowCount(48, 4)).toBe(2);
    expect(pickInfoRowCount(20, 4)).toBe(1);
  });
});

describe('groupInfoRows', () => {
  it('collapses all full booking fields onto one row at the shortest height (calendar priority order)', () => {
    expect(groupInfoRows(1, false)).toEqual([['name', 'time', 'pill', 'service', 'phone']]);
  });

  it('expands all full booking fields onto separate rows at the tallest height', () => {
    expect(groupInfoRows(5, false)).toEqual([
      ['name'],
      ['time'],
      ['pill'],
      ['service'],
      ['phone'],
    ]);
  });

  it('keeps time and status pill together as height grows', () => {
    expect(groupInfoRows(4, false)).toEqual([
      ['name'],
      ['time', 'pill'],
      ['service'],
      ['phone'],
    ]);
    expect(groupInfoRows(3, false)).toEqual([
      ['name'],
      ['time', 'pill'],
      ['service', 'phone'],
    ]);
    expect(groupInfoRows(2, false)).toEqual([
      ['name'],
      ['time', 'pill', 'service', 'phone'],
    ]);
  });
});

describe('pickVisibleInfoRows', () => {
  const widths = {
    name: 90,
    service: 80,
    phone: 70,
    time: 60,
    pill: 50,
  };

  it('keeps name, time, and status before service and phone on a short row', () => {
    expect(
      pickVisibleInfoRows({
        rows: [['name', 'time', 'pill', 'service', 'phone']],
        availableWidth: 260,
        widths,
      }),
    ).toEqual([['name', 'time', 'pill']]);
  });

  it('drops phone and service before time when space is very tight', () => {
    expect(
      pickVisibleInfoRows({
        rows: [['name', 'time', 'pill', 'service', 'phone']],
        availableWidth: 200,
        widths,
      }),
    ).toEqual([['name', 'time']]);
  });

  it('shows all fields when they have dedicated rows', () => {
    expect(
      pickVisibleInfoRows({
        rows: [['name'], ['service'], ['phone'], ['time'], ['pill']],
        availableWidth: 40,
        widths,
      }),
    ).toEqual([['name'], ['service'], ['phone'], ['time'], ['pill']]);
  });
});
