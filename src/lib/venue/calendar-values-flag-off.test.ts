import { describe, expect, it } from 'vitest';
import {
  calendarValueFieldsTurnedOff,
  calendarValuesClearedByFlagChange,
  clearCalendarValuesForFlagsTurnedOff,
} from './calendar-values-flag-off';

/** D6, D56, TERMS-02: turning off a staff permission box clears what calendars stored under it. */

describe('calendarValueFieldsTurnedOff', () => {
  it('lists price, deposit, length and buffer boxes that went from on to off, and nothing else', () => {
    const before = {
      staff_may_customize_price: true,
      staff_may_customize_deposit: true,
      staff_may_customize_duration: false,
      staff_may_customize_buffer: true,
      staff_may_customize_colour: true,
    };
    const after = { ...before, staff_may_customize_price: false, staff_may_customize_colour: false };
    expect(calendarValueFieldsTurnedOff(before, after).map((f) => f.label)).toEqual(['price']);
  });
});

describe('calendarValuesClearedByFlagChange', () => {
  const links = [
    { practitioner_id: 'cal-sam', custom_price_pence: 3000, custom_deposit_pence: 500 },
    { practitioner_id: 'cal-alex', custom_price_pence: null, custom_buffer_minutes: 10 },
    { practitioner_id: 'cal-jo', custom_price_pence: 0 },
  ];
  const names: Record<string, string> = { 'cal-sam': 'Sam', 'cal-alex': 'Alex', 'cal-jo': 'Jo' };

  it('names each calendar that would lose a value, with the values it would lose', () => {
    expect(
      calendarValuesClearedByFlagChange({
        before: { staff_may_customize_price: true, staff_may_customize_deposit: true, staff_may_customize_buffer: true },
        after: { staff_may_customize_price: false, staff_may_customize_deposit: false, staff_may_customize_buffer: true },
        links,
        calendarName: (id) => names[id]!,
      }),
    ).toEqual([
      { calendarId: 'cal-sam', calendarName: 'Sam', fields: ['price', 'deposit'] },
      // A free price (0) is a real value and is cleared too.
      { calendarId: 'cal-jo', calendarName: 'Jo', fields: ['price'] },
    ]);
  });

  it('asks nothing when no box is turned off', () => {
    expect(
      calendarValuesClearedByFlagChange({
        before: { staff_may_customize_price: true },
        after: { staff_may_customize_price: true },
        links,
        calendarName: (id) => names[id]!,
      }),
    ).toEqual([]);
  });
});

describe('clearCalendarValuesForFlagsTurnedOff', () => {
  function fakeAdmin(rowsByColumn: Record<string, string[]>) {
    const updates: Array<{ column: string; serviceItemId: unknown }> = [];
    const admin = {
      from: () => {
        let column = '';
        let serviceItemId: unknown;
        const builder: Record<string, unknown> = {};
        builder.update = (values: Record<string, unknown>) => {
          column = Object.keys(values)[0]!;
          return builder;
        };
        builder.eq = (_col: string, v: unknown) => {
          serviceItemId = v;
          return builder;
        };
        builder.not = () => builder;
        builder.select = () => {
          updates.push({ column, serviceItemId });
          return Promise.resolve({ data: (rowsByColumn[column] ?? []).map((c) => ({ calendar_id: c })), error: null });
        };
        return builder;
      },
    };
    return { admin: admin as never, updates };
  }

  it('clears only the columns whose box was turned off, and reports them per calendar', async () => {
    const { admin, updates } = fakeAdmin({
      custom_price_pence: ['cal-sam', 'cal-jo'],
      custom_deposit_pence: ['cal-sam'],
    });
    const cleared = await clearCalendarValuesForFlagsTurnedOff(admin, {
      serviceItemId: 'svc-1',
      before: { staff_may_customize_price: true, staff_may_customize_deposit: true, staff_may_customize_buffer: true },
      after: { staff_may_customize_price: false, staff_may_customize_deposit: false, staff_may_customize_buffer: true },
    });
    expect(updates).toEqual([
      { column: 'custom_price_pence', serviceItemId: 'svc-1' },
      { column: 'custom_deposit_pence', serviceItemId: 'svc-1' },
    ]);
    expect(cleared).toEqual([
      { calendar_id: 'cal-sam', fields: ['price', 'deposit'] },
      { calendar_id: 'cal-jo', fields: ['price'] },
    ]);
  });

  it('writes nothing when no box was turned off', async () => {
    const { admin, updates } = fakeAdmin({});
    const cleared = await clearCalendarValuesForFlagsTurnedOff(admin, {
      serviceItemId: 'svc-1',
      before: { staff_may_customize_price: false },
      after: { staff_may_customize_price: true },
    });
    expect(updates).toEqual([]);
    expect(cleared).toEqual([]);
  });
});
