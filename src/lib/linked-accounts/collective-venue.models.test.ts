/**
 * D44: the synthetic venue's booking models follow the offering kinds `entity_type` allows, so the
 * page declares appointments and nothing it cannot serve.
 */
import { describe, expect, it } from 'vitest';
import { COLLECTIVE_ENTITY_MODELS, collectiveBookingModels } from './collective-venue';

describe('collectiveBookingModels', () => {
  it('lists appointments alone while services are the only offering kind', () => {
    expect(Object.keys(COLLECTIVE_ENTITY_MODELS)).toEqual(['service']);
    expect(collectiveBookingModels()).toEqual(['unified_scheduling']);
  });
});
