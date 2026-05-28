import { describe, it, expect } from 'vitest';
import { applyAddonsToResolvedService } from './apply-addons-to-service';
import type { Addon, AppointmentService } from '@/types/booking-models';

const baseService: AppointmentService = {
  id: 'svc-1',
  venue_id: 'venue-1',
  name: 'Colour',
  description: null,
  duration_minutes: 60,
  buffer_minutes: 10,
  price_pence: 5000,
  payment_requirement: 'deposit',
  deposit_pence: 1500,
  colour: '#fff',
  is_active: true,
  sort_order: 0,
  created_at: '2026-01-01T00:00:00Z',
};

function addon(partial: Partial<Addon>): Addon {
  return {
    id: 'a-1',
    addon_group_id: 'g-1',
    venue_id: 'venue-1',
    name: 'Test',
    description: null,
    additional_price_pence: 0,
    additional_duration_minutes: 0,
    cost_to_business_pence: null,
    is_active: true,
    sort_order: 0,
    archived_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...partial,
  };
}

describe('applyAddonsToResolvedService', () => {
  it('returns the service unchanged when no addons are selected', () => {
    const out = applyAddonsToResolvedService(baseService, []);
    expect(out.service).toEqual(baseService);
    expect(out.total_addon_price_pence).toBe(0);
    expect(out.total_addon_duration_minutes).toBe(0);
  });

  it('adds duration and price for selected addons', () => {
    const addons = [
      addon({ id: 'a-1', additional_price_pence: 1000, additional_duration_minutes: 15 }),
      addon({ id: 'a-2', additional_price_pence: 500, additional_duration_minutes: 10 }),
    ];
    const out = applyAddonsToResolvedService(baseService, addons);
    expect(out.service.duration_minutes).toBe(60 + 25);
    expect(out.service.price_pence).toBe(5000 + 1500);
    expect(out.service.buffer_minutes).toBe(10); // unchanged
    expect(out.service.deposit_pence).toBe(1500); // unchanged
    expect(out.total_addon_price_pence).toBe(1500);
    expect(out.total_addon_duration_minutes).toBe(25);
  });

  it('preserves null price_pence when no addon has a price', () => {
    const svc: AppointmentService = { ...baseService, price_pence: null };
    const out = applyAddonsToResolvedService(svc, [
      addon({ additional_price_pence: 0, additional_duration_minutes: 5 }),
    ]);
    expect(out.service.price_pence).toBeNull();
    expect(out.service.duration_minutes).toBe(65);
  });

  it('treats null base price as 0 when addons add price', () => {
    const svc: AppointmentService = { ...baseService, price_pence: null };
    const out = applyAddonsToResolvedService(svc, [
      addon({ additional_price_pence: 800, additional_duration_minutes: 0 }),
    ]);
    expect(out.service.price_pence).toBe(800);
  });
});
