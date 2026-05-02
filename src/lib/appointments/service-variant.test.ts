import { describe, expect, it } from 'vitest';
import {
  applyVariantToAppointmentInput,
  applyVariantToService,
  findActiveVariant,
  resolveBookableServiceWithVariant,
  serviceRequiresVariantChoice,
} from './service-variant';
import type { AppointmentService, ServiceVariant } from '@/types/booking-models';

const baseService: AppointmentService = {
  id: 'svc-1',
  venue_id: 'venue-1',
  name: 'Colour',
  description: null,
  duration_minutes: 60,
  buffer_minutes: 10,
  price_pence: 5000,
  payment_requirement: 'deposit',
  deposit_pence: 1000,
  colour: '#fff',
  is_active: true,
  sort_order: 0,
  created_at: '2026-01-01T00:00:00Z',
};

const activeVariant: ServiceVariant = {
  id: 'var-1',
  venue_id: 'venue-1',
  service_item_id: null,
  appointment_service_id: 'svc-1',
  name: 'Full Head',
  description: null,
  duration_minutes: 150,
  buffer_minutes: 15,
  price_pence: 8500,
  deposit_pence: null,
  sort_order: 0,
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
};

const inactiveVariant: ServiceVariant = {
  ...activeVariant,
  id: 'var-2',
  name: 'Hidden',
  is_active: false,
};

describe('serviceRequiresVariantChoice', () => {
  it('returns false when service has no variants', () => {
    expect(serviceRequiresVariantChoice({ ...baseService })).toBe(false);
  });

  it('returns false when only inactive variants exist', () => {
    expect(
      serviceRequiresVariantChoice({ ...baseService, variants: [inactiveVariant] }),
    ).toBe(false);
  });

  it('returns true when at least one active variant exists', () => {
    expect(
      serviceRequiresVariantChoice({
        ...baseService,
        variants: [inactiveVariant, activeVariant],
      }),
    ).toBe(true);
  });
});

describe('findActiveVariant', () => {
  const service = { ...baseService, variants: [activeVariant, inactiveVariant] };

  it('returns null when service or id is missing', () => {
    expect(findActiveVariant(null, 'var-1')).toBeNull();
    expect(findActiveVariant(service, null)).toBeNull();
    expect(findActiveVariant(service, undefined)).toBeNull();
  });

  it('returns null for an unknown variant id', () => {
    expect(findActiveVariant(service, 'missing')).toBeNull();
  });

  it('rejects inactive variants', () => {
    expect(findActiveVariant(service, inactiveVariant.id)).toBeNull();
  });

  it('returns the matching active variant', () => {
    expect(findActiveVariant(service, activeVariant.id)).toEqual(activeVariant);
  });
});

describe('applyVariantToService', () => {
  it('overrides duration, buffer, price and combines display name', () => {
    const result = applyVariantToService(baseService, activeVariant);
    expect(result.name).toBe('Colour - Full Head');
    expect(result.duration_minutes).toBe(150);
    expect(result.buffer_minutes).toBe(15);
    expect(result.price_pence).toBe(8500);
  });

  it('falls back to the parent deposit when the variant deposit is null', () => {
    const result = applyVariantToService(baseService, activeVariant);
    expect(result.deposit_pence).toBe(1000);
  });

  it('uses the variant deposit when set', () => {
    const result = applyVariantToService(baseService, { ...activeVariant, deposit_pence: 2500 });
    expect(result.deposit_pence).toBe(2500);
  });

  it('preserves the parent payment_requirement', () => {
    const result = applyVariantToService(baseService, activeVariant);
    expect(result.payment_requirement).toBe('deposit');
  });
});

describe('resolveBookableServiceWithVariant', () => {
  it('returns the service unchanged when no variant is provided', () => {
    expect(resolveBookableServiceWithVariant(baseService, null)).toBe(baseService);
    expect(resolveBookableServiceWithVariant(baseService, undefined)).toBe(baseService);
  });

  it('applies the variant overrides when provided', () => {
    const result = resolveBookableServiceWithVariant(baseService, activeVariant);
    expect(result.duration_minutes).toBe(150);
    expect(result.name).toBe('Colour - Full Head');
  });
});

describe('applyVariantToAppointmentInput', () => {
  it('mutates the matching service in place and returns true', () => {
    const services: AppointmentService[] = [{ ...baseService }];
    const ok = applyVariantToAppointmentInput({
      services,
      serviceId: baseService.id,
      variant: activeVariant,
    });
    expect(ok).toBe(true);
    expect(services[0]!.duration_minutes).toBe(150);
    expect(services[0]!.price_pence).toBe(8500);
    expect(services[0]!.name).toBe('Colour - Full Head');
  });

  it('returns false when the service is not present in the input', () => {
    const services: AppointmentService[] = [{ ...baseService }];
    const ok = applyVariantToAppointmentInput({
      services,
      serviceId: 'not-in-input',
      variant: activeVariant,
    });
    expect(ok).toBe(false);
    expect(services[0]!.duration_minutes).toBe(60);
  });
});
