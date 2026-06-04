import { describe, expect, it } from 'vitest';
import { selectReplacementHost } from './collectives';

describe('selectReplacementHost', () => {
  it('returns null when there are no survivors', () => {
    expect(selectReplacementHost([])).toBeNull();
  });

  it('returns the only survivor', () => {
    expect(
      selectReplacementHost([{ venueId: 'v1', joinedAt: '2026-01-01T00:00:00Z' }]),
    ).toBe('v1');
  });

  it('picks the longest-tenured (earliest joined) survivor', () => {
    const host = selectReplacementHost([
      { venueId: 'late', joinedAt: '2026-03-01T00:00:00Z' },
      { venueId: 'early', joinedAt: '2026-01-01T00:00:00Z' },
      { venueId: 'mid', joinedAt: '2026-02-01T00:00:00Z' },
    ]);
    expect(host).toBe('early');
  });

  it('sorts members with a known joined_at ahead of those without', () => {
    const host = selectReplacementHost([
      { venueId: 'unknown', joinedAt: null },
      { venueId: 'known', joinedAt: '2026-05-01T00:00:00Z' },
    ]);
    expect(host).toBe('known');
  });

  it('treats an unparseable joined_at as longest-ago (sorts last)', () => {
    const host = selectReplacementHost([
      { venueId: 'garbage', joinedAt: 'not-a-date' },
      { venueId: 'real', joinedAt: '2026-05-01T00:00:00Z' },
    ]);
    expect(host).toBe('real');
  });

  it('breaks ties on equal tenure deterministically by venueId', () => {
    const ts = '2026-01-01T00:00:00Z';
    const host = selectReplacementHost([
      { venueId: 'b', joinedAt: ts },
      { venueId: 'a', joinedAt: ts },
      { venueId: 'c', joinedAt: ts },
    ]);
    expect(host).toBe('a');
  });

  it('does not mutate the input array', () => {
    const survivors = [
      { venueId: 'z', joinedAt: '2026-02-01T00:00:00Z' },
      { venueId: 'a', joinedAt: '2026-01-01T00:00:00Z' },
    ];
    const snapshot = survivors.map((s) => s.venueId);
    selectReplacementHost(survivors);
    expect(survivors.map((s) => s.venueId)).toEqual(snapshot);
  });
});
