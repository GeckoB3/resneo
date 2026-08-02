import { describe, expect, it } from 'vitest';
import { normaliseServiceNameForMerge, sourceDescriptionForProviders } from './catalogue';

describe('sourceDescriptionForProviders', () => {
  const HOST = 'venue-host';
  const MEMBER = 'venue-member';
  const index = new Map<string, { description: string | null }>([
    [`${HOST}:s1`, { description: 'Host copy' }],
    [`${MEMBER}:s1`, { description: 'Member copy' }],
    [`${HOST}:s2`, { description: null }],
    [`${MEMBER}:s2`, { description: 'Member copy only' }],
  ]);

  it('prefers the host venue when providers disagree', () => {
    const providers = [
      { venueId: MEMBER, sourceServiceId: 's1' },
      { venueId: HOST, sourceServiceId: 's1' },
    ];
    expect(sourceDescriptionForProviders(providers, index, HOST)).toBe('Host copy');
  });

  it('falls back to another provider when the host has written none', () => {
    const providers = [
      { venueId: HOST, sourceServiceId: 's2' },
      { venueId: MEMBER, sourceServiceId: 's2' },
    ];
    expect(sourceDescriptionForProviders(providers, index, HOST)).toBe('Member copy only');
  });

  it('falls back to the first provider with copy when the host does not provide the offering', () => {
    const providers = [{ venueId: MEMBER, sourceServiceId: 's1' }];
    expect(sourceDescriptionForProviders(providers, index, HOST)).toBe('Member copy');
  });

  it('returns null when no provider has a description', () => {
    const providers = [{ venueId: HOST, sourceServiceId: 's2' }];
    expect(sourceDescriptionForProviders(providers, index, null)).toBeNull();
  });

  it('returns null for an offering with no providers', () => {
    expect(sourceDescriptionForProviders([], index, HOST)).toBeNull();
  });
});

describe('normaliseServiceNameForMerge', () => {
  it('lowercases and collapses whitespace', () => {
    expect(normaliseServiceNameForMerge('  Swedish   Massage ')).toBe('swedish massage');
  });
  it('strips trailing duration tokens', () => {
    expect(normaliseServiceNameForMerge('Swedish Massage 60min')).toBe('swedish massage');
    expect(normaliseServiceNameForMerge('Swedish Massage 1 hour')).toBe('swedish massage');
    expect(normaliseServiceNameForMerge('Deep Tissue 90 minutes')).toBe('deep tissue');
  });
  it('drops parenthetical asides', () => {
    expect(normaliseServiceNameForMerge('Facial (45 mins)')).toBe('facial');
  });
  it('ignores punctuation differences', () => {
    expect(normaliseServiceNameForMerge('Gel-Polish: Hands')).toBe(
      normaliseServiceNameForMerge('Gel Polish Hands'),
    );
  });
  it('normalises diacritics', () => {
    expect(normaliseServiceNameForMerge('Manicüre')).toBe('manicure');
  });
});

