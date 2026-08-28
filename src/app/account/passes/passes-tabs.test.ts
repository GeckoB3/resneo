import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PASSES_TAB,
  PASSES_TABS,
  parsePassesTab,
  passesHref,
  type PassesTab,
} from './passes-tabs';

/**
 * P1-5's redirects are the part of this task that can lose a customer's money.
 *
 * `/account/credits`, `/account/courses` and `/account/memberships` are deep
 * link targets minted by the class booking flow with `venue`, `product`,
 * `course`, `plan` and `autostart=1` on them, and links in that shape are
 * already sitting in inboxes. Drop the query on the way to `/account/passes`
 * and nothing errors: the section falls back to the FIRST venue and the FIRST
 * product in the catalogue and charges those instead, which is G25 exactly, on
 * a Stripe Connect account belonging to a venue the customer never chose. The
 * fixtures below therefore put the interesting value second wherever order
 * could hide the bug.
 */

describe('parsePassesTab', () => {
  for (const tab of PASSES_TABS) {
    it(`accepts ${tab.id}`, () => {
      expect(parsePassesTab(tab.id)).toBe(tab.id);
    });
  }

  it('falls back to the default rather than throwing on an unknown tab', () => {
    // A stale link should still show the customer their passes.
    expect(parsePassesTab('vouchers')).toBe(DEFAULT_PASSES_TAB);
    expect(parsePassesTab('')).toBe(DEFAULT_PASSES_TAB);
    expect(parsePassesTab(undefined)).toBe(DEFAULT_PASSES_TAB);
    expect(parsePassesTab(null)).toBe(DEFAULT_PASSES_TAB);
  });

  it('takes the first recognised value from a repeated param', () => {
    // Next hands a repeated `?tab=` through as an array.
    expect(parsePassesTab(['courses', 'recurring'])).toBe('courses');
    expect(parsePassesTab(['nonsense', 'recurring'])).toBe('recurring');
    expect(parsePassesTab([])).toBe(DEFAULT_PASSES_TAB);
  });

  it('tolerates surrounding whitespace', () => {
    expect(parsePassesTab(' memberships ')).toBe('memberships');
  });

  it('does not accept a tab by prefix or by case', () => {
    // Guards a `startsWith`/`toLowerCase` reimplementation: neither should
    // resolve, because both would let a typo silently pick a real tab.
    expect(parsePassesTab('credits-and-packs')).toBe(DEFAULT_PASSES_TAB);
    expect(parsePassesTab('Memberships')).toBe(DEFAULT_PASSES_TAB);
  });
});

describe('passesHref', () => {
  it('names the tab it was asked for', () => {
    expect(passesHref('memberships')).toBe('/account/passes?tab=memberships');
    expect(passesHref('recurring', {})).toBe('/account/passes?tab=recurring');
  });

  it('carries a membership deep link through intact (G25)', () => {
    const href = passesHref('memberships', {
      venue: 'venue-target',
      plan: 'plan-target',
      autostart: '1',
    });
    const url = new URL(href, 'https://resneo.test');
    expect(url.pathname).toBe('/account/passes');
    expect(url.searchParams.get('tab')).toBe('memberships');
    // The three that decide what gets charged, and on whose account.
    expect(url.searchParams.get('venue')).toBe('venue-target');
    expect(url.searchParams.get('plan')).toBe('plan-target');
    expect(url.searchParams.get('autostart')).toBe('1');
  });

  it('carries the credits and courses deep links through too', () => {
    const credits = new URL(
      passesHref('credits', { venue: 'venue-target', product: 'pack-target', autostart: '1' }),
      'https://resneo.test',
    );
    expect(credits.searchParams.get('product')).toBe('pack-target');
    expect(credits.searchParams.get('venue')).toBe('venue-target');

    const courses = new URL(
      passesHref('courses', { venue: 'venue-target', course: 'course-target', autostart: '1' }),
      'https://resneo.test',
    );
    expect(courses.searchParams.get('course')).toBe('course-target');
    expect(courses.searchParams.get('venue')).toBe('venue-target');
  });

  it('lets the redirecting route win over a tab already in the link', () => {
    // `/account/credits?tab=memberships` must still land on credits: the path
    // the customer followed decides, not a param they can edit.
    const url = new URL(
      passesHref('credits', { tab: 'memberships', venue: 'v1' }),
      'https://resneo.test',
    );
    expect(url.searchParams.getAll('tab')).toEqual(['credits']);
    expect(url.searchParams.get('venue')).toBe('v1');
  });

  it('preserves repeated params in order rather than collapsing them', () => {
    const url = new URL(passesHref('credits', { venue: ['v1', 'v2'] }), 'https://resneo.test');
    expect(url.searchParams.getAll('venue')).toEqual(['v1', 'v2']);
  });

  it('drops params with no value, and keeps an empty string', () => {
    const href = passesHref('credits', { venue: undefined, product: '' });
    const url = new URL(href, 'https://resneo.test');
    expect(url.searchParams.has('venue')).toBe(false);
    expect(url.searchParams.get('product')).toBe('');
  });

  it('encodes values rather than pasting them into the URL', () => {
    // An unencoded `&` would split one param into two and hand the section a
    // value it never checked.
    const url = new URL(
      passesHref('credits', { venue: 'a&autostart=1', product: 'p p' }),
      'https://resneo.test',
    );
    expect(url.searchParams.get('venue')).toBe('a&autostart=1');
    expect(url.searchParams.get('product')).toBe('p p');
    expect(url.searchParams.getAll('autostart')).toEqual([]);
  });

  it('round-trips through parsePassesTab for every tab', () => {
    for (const tab of PASSES_TABS) {
      const url = new URL(passesHref(tab.id, { venue: 'v' }), 'https://resneo.test');
      expect(parsePassesTab(url.searchParams.get('tab'))).toBe(tab.id);
    }
  });
});

describe('the tab set itself', () => {
  it('covers the four sections P1-5 consolidates, with no duplicates', () => {
    const ids: PassesTab[] = PASSES_TABS.map((t) => t.id);
    expect(ids).toEqual(['credits', 'courses', 'memberships', 'recurring']);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(PASSES_TABS.map((t) => t.label)).size).toBe(PASSES_TABS.length);
  });

  it('has no empty labels and defaults to a real tab', () => {
    for (const t of PASSES_TABS) expect(t.label.trim().length).toBeGreaterThan(0);
    expect(PASSES_TABS.some((t) => t.id === DEFAULT_PASSES_TAB)).toBe(true);
  });
});
