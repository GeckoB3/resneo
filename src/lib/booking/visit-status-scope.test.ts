import { describe, expect, it } from 'vitest';
import { isServiceLevelStatus, statusChangeCascadesAcrossVisit } from './visit-status-scope';

describe('statusChangeCascadesAcrossVisit', () => {
  it('cascades a confirm and its undo across the visit', () => {
    expect(statusChangeCascadesAcrossVisit('Booked', 'Confirmed')).toBe(true);
    expect(statusChangeCascadesAcrossVisit('Pending', 'Booked')).toBe(true);
    expect(statusChangeCascadesAcrossVisit('Confirmed', 'Booked')).toBe(true);
  });

  it('keeps Start, Complete and their undos on the one service', () => {
    expect(statusChangeCascadesAcrossVisit('Confirmed', 'Seated')).toBe(false);
    expect(statusChangeCascadesAcrossVisit('Booked', 'Seated')).toBe(false);
    expect(statusChangeCascadesAcrossVisit('Seated', 'Completed')).toBe(false);
    expect(statusChangeCascadesAcrossVisit('Seated', 'Booked')).toBe(false);
    expect(statusChangeCascadesAcrossVisit('Seated', 'Confirmed')).toBe(false);
    expect(statusChangeCascadesAcrossVisit('Completed', 'Seated')).toBe(false);
  });

  it('names the service-level statuses', () => {
    expect(isServiceLevelStatus('Seated')).toBe(true);
    expect(isServiceLevelStatus('Completed')).toBe(true);
    expect(isServiceLevelStatus('Confirmed')).toBe(false);
    expect(isServiceLevelStatus(null)).toBe(false);
  });
});
