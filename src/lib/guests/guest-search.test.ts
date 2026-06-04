import { describe, expect, it } from 'vitest';
import {
  applyGuestSearch,
  guestSearchOrGroups,
  sanitiseIlikeSearch,
} from './guest-contacts-list';

/** Sanitise the way the route does, then build the OR groups. */
function groups(raw: string): string[] {
  return guestSearchOrGroups(sanitiseIlikeSearch(raw.trim()));
}

describe('guestSearchOrGroups', () => {
  it('matches a single name/email token across all fields', () => {
    const g = groups('andrew');
    expect(g).toHaveLength(1);
    expect(g[0]).toContain('first_name.ilike.%andrew%');
    expect(g[0]).toContain('last_name.ilike.%andrew%');
    expect(g[0]).toContain('email.ilike.%andrew%');
    expect(g[0]).toContain('phone.ilike.%andrew%');
  });

  it('AND-s tokens so a first+last combination matches (one group per token)', () => {
    // "And cour" → token "And" (matches Andrew via first_name) AND token "cour"
    // (matches Courtney via last_name). Two groups, AND-ed by the caller.
    const g = groups('And cour');
    expect(g).toHaveLength(2);
    expect(g[0]).toContain('first_name.ilike.%And%');
    expect(g[1]).toContain('last_name.ilike.%cour%');
  });

  it('handles a full "First Last" query as two tokens', () => {
    const g = groups('Andrew Courtney');
    expect(g).toHaveLength(2);
    expect(g[0]).toContain('first_name.ilike.%Andrew%');
    expect(g[1]).toContain('last_name.ilike.%Courtney%');
  });

  it('matches a phone fragment by its digits and the leading-0 → E.164 form', () => {
    const g = groups('07725 123');
    expect(g).toHaveLength(2);
    // "07725": raw digits + the significant number without the leading 0.
    expect(g[0]).toContain('phone.ilike.%07725%');
    expect(g[0]).toContain('phone.ilike.%7725%');
    // "123": still a phone fragment.
    expect(g[1]).toContain('phone.ilike.%123%');
  });

  it('strips formatting so a parenthesised/spaced number still matches', () => {
    const g = groups('(0772) 5123');
    // Parens removed; each chunk searched by digits.
    expect(g.join('|')).toContain('phone.ilike.%0772%');
    expect(g.join('|')).toContain('phone.ilike.%5123%');
    expect(g.join('|')).not.toContain('(');
  });

  it('returns no groups for an empty/whitespace query', () => {
    expect(guestSearchOrGroups('')).toEqual([]);
    expect(guestSearchOrGroups('   ')).toEqual([]);
  });

  it('keeps ilike wildcards escaped (no injection via % or _)', () => {
    const g = groups('50%_off');
    // sanitiseIlikeSearch escapes % and _ so they match literally.
    expect(g[0]).toContain('first_name.ilike.%50\\%\\_off%');
  });
});

describe('applyGuestSearch', () => {
  it('chains one .or() per token (AND-ed) onto the query builder', () => {
    const calls: string[] = [];
    const fake = {
      or(filters: string) {
        calls.push(filters);
        return fake;
      },
    };
    applyGuestSearch(fake, 'andrew courtney');
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain('first_name.ilike.%andrew%');
    expect(calls[1]).toContain('last_name.ilike.%courtney%');
  });

  it('does not touch the query for an empty search', () => {
    const calls: string[] = [];
    const fake = {
      or(filters: string) {
        calls.push(filters);
        return fake;
      },
    };
    applyGuestSearch(fake, '');
    expect(calls).toHaveLength(0);
  });
});
