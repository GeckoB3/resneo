import { describe, expect, it } from 'vitest';
import { estimatedEndMinutesFromDb } from '@/lib/experience-events/calendar-event-window-conflicts';

describe('estimatedEndMinutesFromDb', () => {
  it('parses plain time / timestamptz fragments as wall-clock HH:mm', () => {
    expect(estimatedEndMinutesFromDb('11:15:00')).toBe(11 * 60 + 15);
    expect(estimatedEndMinutesFromDb('11:15:00Z')).toBe(11 * 60 + 15);
  });

  it('reads the clock time after T for full ISO timestamps', () => {
    expect(estimatedEndMinutesFromDb('2026-05-12T14:30:00.000Z')).toBe(14 * 60 + 30);
    expect(estimatedEndMinutesFromDb('2026-05-12T09:05:06+01:00')).toBe(9 * 60 + 5);
  });
});
