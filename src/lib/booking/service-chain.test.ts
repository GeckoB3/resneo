import { describe, expect, it } from 'vitest';
import {
  MAX_SERVICES_PER_VISIT,
  chainSpanMinutes,
  parseServiceChainParam,
  serialiseServiceChainParam,
} from './service-chain';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const V = '33333333-3333-4333-8333-333333333333';

describe('parseServiceChainParam', () => {
  it('returns null for an absent parameter', () => {
    expect(parseServiceChainParam(null)).toEqual({ ok: true, chain: null });
    expect(parseServiceChainParam('')).toEqual({ ok: true, chain: null });
  });

  it('accepts a well-formed chain', () => {
    const raw = JSON.stringify([{ service_id: A }, { service_id: B, variant_id: V, addon_ids: [A], duration_minutes: 45 }]);
    const parsed = parseServiceChainParam(raw);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.chain).toHaveLength(2);
      expect(parsed.chain?.[1]?.variant_id).toBe(V);
    }
  });

  it('refuses bad JSON, non-uuids and more than the visit cap', () => {
    expect(parseServiceChainParam('{')).toEqual({ ok: false, error: 'services must be JSON' });
    expect(parseServiceChainParam(JSON.stringify([{ service_id: 'cut' }]))).toEqual({ ok: false, error: 'Invalid services' });
    const tooMany = Array.from({ length: MAX_SERVICES_PER_VISIT + 1 }, () => ({ service_id: A }));
    expect(parseServiceChainParam(JSON.stringify(tooMany))).toEqual({ ok: false, error: 'Invalid services' });
  });
});

describe('serialiseServiceChainParam', () => {
  it('round-trips through the parser and drops empty optionals', () => {
    const raw = serialiseServiceChainParam([
      { service_id: A, variant_id: null, addon_ids: [], duration_minutes: null },
      { service_id: B, variant_id: V, addon_ids: [A], duration_minutes: 40 },
    ]);
    expect(JSON.parse(raw)).toEqual([{ service_id: A }, { service_id: B, variant_id: V, addon_ids: [A], duration_minutes: 40 }]);
    expect(parseServiceChainParam(raw).ok).toBe(true);
  });
});

describe('chainSpanMinutes', () => {
  it('adds the buffers between services, not the one after the last', () => {
    expect(
      chainSpanMinutes([
        { durationMinutes: 30, bufferMinutes: 10 },
        { durationMinutes: 45, bufferMinutes: 5 },
        { durationMinutes: 15, bufferMinutes: 20 },
      ]),
    ).toBe(105);
  });
});
