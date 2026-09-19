/**
 * The three levels of link (Docs/link-and-collective-setup-wizard-plan.md, L2): each preset reads
 * back as itself, only full access unlocks a collective, and anything else is custom.
 */
import { describe, expect, it } from 'vitest';
import { LINK_LEVELS, grantForLevel, isFullAccessBothWays, levelForGrants } from './link-levels';

describe('link levels', () => {
  it('round-trips every preset, both ways', () => {
    for (const level of LINK_LEVELS) {
      expect(levelForGrants(grantForLevel(level.id), grantForLevel(level.id))).toBe(level.id);
    }
  });

  it('only full access, both ways, unlocks a collective', () => {
    expect(LINK_LEVELS.filter((l) => l.unlocksCollective).map((l) => l.id)).toEqual(['full']);
    expect(isFullAccessBothWays(grantForLevel('full'), grantForLevel('full'))).toBe(true);
    expect(isFullAccessBothWays(grantForLevel('full'), grantForLevel('manage'))).toBe(false);
    expect(isFullAccessBothWays(grantForLevel('view'), grantForLevel('view'))).toBe(false);
  });

  it('reads two different directions, or a calendar limit, as custom', () => {
    expect(levelForGrants(grantForLevel('full'), grantForLevel('view'))).toBe('custom');
    expect(levelForGrants({ ...grantForLevel('full'), calendarIds: ['cal-1'] }, grantForLevel('full'))).toBe('custom');
    expect(isFullAccessBothWays({ ...grantForLevel('full'), calendarIds: ['cal-1'] }, grantForLevel('full'))).toBe(false);
  });

  it('gives each level a fresh grant object', () => {
    const a = grantForLevel('view');
    a.pii = true;
    expect(grantForLevel('view').pii).toBe(false);
  });
});
