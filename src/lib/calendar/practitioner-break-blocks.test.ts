import { describe, expect, it } from 'vitest';
import { buildPractitionerBreakBlocks } from '@/lib/calendar/practitioner-break-blocks';
import type { Practitioner } from '@/types/booking-models';

describe('buildPractitionerBreakBlocks', () => {
  it('emits a break block on a working day', () => {
    const prac: Pick<
      Practitioner,
      'id' | 'is_active' | 'break_times' | 'break_times_by_day' | 'working_hours' | 'days_off'
    > = {
      id: 'p1',
      is_active: true,
      break_times: [{ start: '12:00', end: '13:00' }],
      break_times_by_day: null,
      working_hours: { '1': [{ start: '09:00', end: '17:00' }] },
      days_off: [],
    };
    const blocks = buildPractitionerBreakBlocks([prac], '2030-06-03', '2030-06-03');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      practitioner_id: 'p1',
      block_date: '2030-06-03',
      start_time: '12:00',
      end_time: '13:00',
      block_type: 'break',
    });
  });

  it('skips breaks on days with no working hours', () => {
    const prac: Pick<
      Practitioner,
      'id' | 'is_active' | 'break_times' | 'break_times_by_day' | 'working_hours' | 'days_off'
    > = {
      id: 'p1',
      is_active: true,
      break_times: [{ start: '12:00', end: '13:00' }],
      break_times_by_day: null,
      working_hours: { '1': [] },
      days_off: [],
    };
    const blocks = buildPractitionerBreakBlocks([prac], '2030-06-03', '2030-06-03');
    expect(blocks).toHaveLength(0);
  });
});
