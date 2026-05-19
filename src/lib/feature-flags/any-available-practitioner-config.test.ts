import { describe, expect, it, vi } from 'vitest';
import {
  collapsePooledSlotsByStartTime,
  effectiveCalendarOrder,
  pickPractitionerSlotForPooledTime,
} from '@/lib/feature-flags/any-available-practitioner-config';
import type { PractitionerSlot } from '@/lib/availability/appointment-engine';

const slot = (practitionerId: string, name: string, start: string): PractitionerSlot => ({
  practitioner_id: practitionerId,
  practitioner_name: name,
  service_id: 's1',
  service_name: 'Cut',
  start_time: start,
  duration_minutes: 30,
  price_pence: 2000,
});

describe('any-available-practitioner-config', () => {
  it('effectiveCalendarOrder prefers configured ids then fallbacks', () => {
    expect(
      effectiveCalendarOrder(
        { mode: 'priority', calendar_order: ['b', 'a'] },
        ['a', 'b', 'c'],
        ['c', 'a', 'b'],
      ),
    ).toEqual(['b', 'a', 'c']);
  });

  it('priority pick chooses earliest ranked practitioner', () => {
    const picked = pickPractitionerSlotForPooledTime(
      [slot('p2', 'Sam', '10:00'), slot('p1', 'Alex', '10:00')],
      { mode: 'priority', calendar_order: ['p1', 'p2'] },
      ['p1', 'p2'],
    );
    expect(picked?.practitioner_id).toBe('p1');
  });

  it('random pick uses Math.random', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const picked = pickPractitionerSlotForPooledTime(
      [slot('p1', 'Alex', '10:00'), slot('p2', 'Sam', '10:00')],
      { mode: 'random', calendar_order: [] },
      [],
    );
    expect(picked?.practitioner_id).toBe('p2');
    vi.restoreAllMocks();
  });

  it('collapse keeps one slot per start time', () => {
    const collapsed = collapsePooledSlotsByStartTime(
      [slot('p2', 'Sam', '10:00'), slot('p1', 'Alex', '10:00'), slot('p2', 'Sam', '11:00')],
      { mode: 'priority', calendar_order: ['p1', 'p2'] },
      ['p1', 'p2'],
    );
    expect(collapsed).toHaveLength(2);
    expect(collapsed[0]?.practitioner_id).toBe('p1');
  });
});
