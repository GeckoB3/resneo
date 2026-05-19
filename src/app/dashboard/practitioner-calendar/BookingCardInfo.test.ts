import { describe, expect, it } from 'vitest';
import {
  groupInfoRows,
  pickInfoRowCount,
  pickVisibleInfoRows,
  RECEPTION_INFO_FIELD_ORDER,
} from './BookingCardInfo';

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

  it('compact density uses tighter height thresholds', () => {
    expect(pickInfoRowCount(45, 5, 'comfortable')).toBe(1);
    expect(pickInfoRowCount(45, 5, 'compact')).toBe(2);
  });
});

describe('groupInfoRows', () => {
  it('collapses all full booking fields onto one row at the shortest height (calendar priority order)', () => {
    expect(groupInfoRows(1, false)).toEqual([['name', 'service', 'phone', 'time', 'pill']]);
  });

  it('expands all full booking fields onto separate rows at the tallest height', () => {
    expect(groupInfoRows(5, false)).toEqual([
      ['name'],
      ['service'],
      ['phone'],
      ['time'],
      ['pill'],
    ]);
  });

  it('merges lower-priority fields as height shrinks', () => {
    expect(groupInfoRows(4, false)).toEqual([
      ['name'],
      ['service'],
      ['phone'],
      ['time', 'pill'],
    ]);
    expect(groupInfoRows(3, false)).toEqual([
      ['name'],
      ['service', 'phone'],
      ['time', 'pill'],
    ]);
    expect(groupInfoRows(2, false)).toEqual([
      ['name'],
      ['service', 'phone', 'time', 'pill'],
    ]);
  });

  it('lays out segment blocks without name in service-first order', () => {
    expect(groupInfoRows(1, true)).toEqual([['service', 'phone', 'time', 'pill']]);
    expect(groupInfoRows(4, true)).toEqual([
      ['service'],
      ['phone'],
      ['time'],
      ['pill'],
    ]);
  });

  it('reception layout prioritises time, name, and status on the first row', () => {
    expect(groupInfoRows(2, false, 'reception')).toEqual([
      ['time', 'name', 'pill'],
      ['service', 'phone'],
    ]);
    expect(groupInfoRows(1, false, 'reception')).toEqual([RECEPTION_INFO_FIELD_ORDER]);
  });

  it('compact reception layout drops phone on short bars', () => {
    expect(groupInfoRows(2, false, 'reception', 'compact')).toEqual([
      ['time', 'name', 'pill'],
      ['service'],
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

  it('keeps name, service, and phone before time and status on a short row', () => {
    expect(
      pickVisibleInfoRows({
        rows: [['name', 'service', 'phone', 'time', 'pill']],
        availableWidth: 260,
        widths,
        fieldOrder: ['name', 'service', 'phone', 'time', 'pill'],
      }),
    ).toEqual([['name', 'service', 'phone']]);
  });

  it('drops time and status before service when space is very tight', () => {
    expect(
      pickVisibleInfoRows({
        rows: [['name', 'service', 'phone', 'time', 'pill']],
        availableWidth: 200,
        widths,
        fieldOrder: ['name', 'service', 'phone', 'time', 'pill'],
      }),
    ).toEqual([['name', 'service']]);
  });

  it('reception order keeps time and name before service when space is tight', () => {
    expect(
      pickVisibleInfoRows({
        rows: [['time', 'name', 'pill', 'service', 'phone']],
        availableWidth: 200,
        widths,
        fieldOrder: RECEPTION_INFO_FIELD_ORDER,
      }),
    ).toEqual([['time', 'name']]);
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
