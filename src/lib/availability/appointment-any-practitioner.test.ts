import { describe, expect, it } from 'vitest';
import {
  ANY_AVAILABLE_PRACTITIONER_ID,
  buildAnyAvailableAvailabilityPayload,
  isAnyAvailablePractitionerId,
  poolAppointmentSlotsForService,
} from '@/lib/availability/appointment-any-practitioner';
import type { AppointmentAvailabilityResult } from '@/lib/availability/appointment-engine';

const sample: AppointmentAvailabilityResult = {
  practitioners: [
    {
      id: 'p1',
      name: 'Alex',
      services: [{ id: 's1', name: 'Cut', duration_minutes: 30, price_pence: 2000, deposit_pence: null }],
      slots: [
        {
          practitioner_id: 'p1',
          practitioner_name: 'Alex',
          service_id: 's1',
          service_name: 'Cut',
          start_time: '10:00',
          duration_minutes: 30,
          price_pence: 2000,
        },
      ],
    },
    {
      id: 'p2',
      name: 'Sam',
      services: [{ id: 's1', name: 'Cut', duration_minutes: 30, price_pence: 2500, deposit_pence: null }],
      slots: [
        {
          practitioner_id: 'p2',
          practitioner_name: 'Sam',
          service_id: 's1',
          service_name: 'Cut',
          start_time: '09:30',
          duration_minutes: 30,
          price_pence: 2500,
        },
      ],
    },
  ],
};

describe('appointment-any-practitioner', () => {
  it('detects sentinel id', () => {
    expect(isAnyAvailablePractitionerId(ANY_AVAILABLE_PRACTITIONER_ID)).toBe(true);
    expect(isAnyAvailablePractitionerId('p1')).toBe(false);
  });

  it('pools slots sorted by time', () => {
    const pooled = poolAppointmentSlotsForService(sample, 's1');
    expect(pooled.map((s) => s.start_time)).toEqual(['09:30', '10:00']);
    expect(pooled[0]?.practitioner_id).toBe('p2');
  });

  it('builds synthetic practitioner payload', () => {
    const out = buildAnyAvailableAvailabilityPayload(sample, 's1');
    expect(out.practitioners).toHaveLength(1);
    expect(out.practitioners[0]?.id).toBe(ANY_AVAILABLE_PRACTITIONER_ID);
    expect(out.practitioners[0]?.slots).toHaveLength(2);
  });
});
