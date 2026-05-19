import { describe, expect, it, vi } from 'vitest';
import {
  createAppointmentBookingFromWaitlistEntry,
  endHHmmFromDuration,
} from './create-appointment-from-waitlist';

describe('endHHmmFromDuration', () => {
  it('adds duration within the same day', () => {
    expect(endHHmmFromDuration('09:00', 30)).toBe('09:30');
    expect(endHHmmFromDuration('14:45', 30)).toBe('15:15');
  });
});

describe('createAppointmentBookingFromWaitlistEntry', () => {
  it('requires a service id', async () => {
    const admin = {} as never;
    const result = await createAppointmentBookingFromWaitlistEntry(admin, 'v1', 's1', {
      desired_date: '2026-06-15',
      desired_time: '10:00',
      appointment_service_id: null,
      service_item_id: null,
      practitioner_id: null,
      guest_first_name: 'Alex',
      guest_last_name: 'Smith',
      guest_email: 'alex@example.com',
      guest_phone: '+447700900123',
      notes: null,
    });
    expect(result).toEqual({
      ok: false,
      error: 'Appointment waitlist entry is missing a service.',
      status: 400,
    });
  });

  it('requires a preferred time', async () => {
    const result = await createAppointmentBookingFromWaitlistEntry({} as never, 'v1', 's1', {
      desired_date: '2026-06-15',
      desired_time: null,
      appointment_service_id: null,
      service_item_id: 'svc-1',
      practitioner_id: null,
      guest_first_name: 'Alex',
      guest_last_name: 'Smith',
      guest_email: null,
      guest_phone: '+447700900123',
      notes: null,
    });
    expect(result).toEqual({
      ok: false,
      error: 'Set a preferred time on this waitlist entry before booking.',
      status: 400,
    });
  });

  it('returns 404 when venue is missing', async () => {
    const admin = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({ data: null, error: null })),
          })),
        })),
      })),
    };

    const result = await createAppointmentBookingFromWaitlistEntry(
      admin as never,
      'v1',
      's1',
      {
        desired_date: '2026-06-15',
        desired_time: '10:00',
        appointment_service_id: null,
        service_item_id: 'svc-1',
        practitioner_id: null,
        guest_first_name: 'Alex',
        guest_last_name: 'Smith',
        guest_email: null,
        guest_phone: '+447700900123',
        notes: null,
      },
    );

    expect(result).toEqual({ ok: false, error: 'Venue not found', status: 404 });
  });
});
