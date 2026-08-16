import { describe, expect, it } from 'vitest';
import { applyReservedDurationToInput } from './reserved-appointment-duration';
import type { AppointmentService, ServiceVariant } from '@/types/booking-models';

function services(): AppointmentService[] {
  return [
    {
      id: 'svc-parent',
      name: 'Colour',
      duration_minutes: 30,
      buffer_minutes: 0,
      processing_time_minutes: 0,
      processing_time_blocks: [],
      is_active: true,
    } as unknown as AppointmentService,
    {
      id: 'svc-other',
      name: 'Trim',
      duration_minutes: 20,
      buffer_minutes: 0,
      processing_time_minutes: 0,
      processing_time_blocks: [],
      is_active: true,
    } as unknown as AppointmentService,
  ];
}

const LONG_VARIANT = {
  id: 'var-1',
  service_id: 'svc-parent',
  name: 'Full head',
  duration_minutes: 150,
  is_active: true,
} as unknown as ServiceVariant;

describe('applyReservedDurationToInput', () => {
  it('reserves the variant duration, not the parent (SA-C2)', () => {
    // The reported failure: a 150-minute variant of a 30-minute parent passed a
    // check for 16:30-17:00 and was written ending at 19:00.
    const list = services();
    const reserved = applyReservedDurationToInput({
      services: list,
      serviceId: 'svc-parent',
      variant: LONG_VARIANT,
    });

    expect(reserved).toBe(150);
    expect(list[0]!.duration_minutes).toBe(150);
  });

  it('adds add-on minutes on top of the variant, not the parent', () => {
    // Order matters: applying the variant REPLACES the duration, so folding
    // add-ons in first would lose them. 150 + 20, never 30 + 20 or 150.
    const list = services();
    const reserved = applyReservedDurationToInput({
      services: list,
      serviceId: 'svc-parent',
      variant: LONG_VARIANT,
      extraMinutes: 20,
    });

    expect(reserved).toBe(170);
    expect(list[0]!.duration_minutes).toBe(170);
  });

  it('adds add-on minutes to the parent when there is no variant', () => {
    const list = services();
    const reserved = applyReservedDurationToInput({
      services: list,
      serviceId: 'svc-parent',
      variant: null,
      extraMinutes: 15,
    });

    expect(reserved).toBe(45);
  });

  it('returns the unchanged duration when neither applies', () => {
    const list = services();
    const reserved = applyReservedDurationToInput({
      services: list,
      serviceId: 'svc-parent',
    });

    expect(reserved).toBe(30);
    expect(list[0]!.duration_minutes).toBe(30);
  });

  it('leaves every other service alone', () => {
    const list = services();
    applyReservedDurationToInput({
      services: list,
      serviceId: 'svc-parent',
      variant: LONG_VARIANT,
      extraMinutes: 20,
    });

    expect(list[1]!.duration_minutes).toBe(20);
  });

  it('reports null when the service is not in the input', () => {
    const list = services();
    const reserved = applyReservedDurationToInput({
      services: list,
      serviceId: 'svc-missing',
      variant: LONG_VARIANT,
    });

    expect(reserved).toBeNull();
    expect(list.map((s) => s.duration_minutes)).toEqual([30, 20]);
  });

  it('ignores absent, negative and fractional extra minutes', () => {
    // `addons_total_duration_minutes` comes off a booking row and may be null.
    expect(
      applyReservedDurationToInput({
        services: services(),
        serviceId: 'svc-parent',
        extraMinutes: undefined,
      }),
    ).toBe(30);
    expect(
      applyReservedDurationToInput({
        services: services(),
        serviceId: 'svc-parent',
        extraMinutes: -10,
      }),
    ).toBe(30);
    expect(
      applyReservedDurationToInput({
        services: services(),
        serviceId: 'svc-parent',
        extraMinutes: 12.4,
      }),
    ).toBe(42);
  });
});
