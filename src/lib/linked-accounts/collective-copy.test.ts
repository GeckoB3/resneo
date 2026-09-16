/**
 * The collective's words (UX spec §5, the copy deck).
 *
 * These are the sentences venues read, so the guards are about the writing itself: house style (no
 * em-dashes), no placeholder ever reaching a screen unfilled, and the venue list reading like a
 * sentence however many venues there are.
 */
import { describe, expect, it } from 'vitest';
import {
  COLLECTIVE_COPY,
  COLLECTIVE_COPY_ALIASES,
  collectiveCopy,
  collectiveCopyPlaceholders,
  formatVenueList,
  type CollectiveCopyId,
} from './collective-copy';

const ids = Object.keys(COLLECTIVE_COPY) as CollectiveCopyId[];

describe('the copy deck', () => {
  it('uses no em-dashes anywhere (house style)', () => {
    const offenders = ids.filter((id) => COLLECTIVE_COPY[id].includes('—'));
    expect(offenders).toEqual([]);
  });

  it('says something in every entry', () => {
    expect(ids.filter((id) => COLLECTIVE_COPY[id].trim() === '')).toEqual([]);
  });

  it('never hides a curly brace that is not a placeholder', () => {
    const offenders = ids.filter((id) => /[{}]/.test(COLLECTIVE_COPY[id].replace(/\{\w+\}/g, '')));
    expect(offenders).toEqual([]);
  });

  it('points every alias at a sentence that exists', () => {
    for (const target of Object.values(COLLECTIVE_COPY_ALIASES)) {
      expect(COLLECTIVE_COPY[target]).toBeTruthy();
    }
  });
});

describe('collectiveCopy', () => {
  it('fills every placeholder it is given', () => {
    expect(collectiveCopy('svc.save.allDone', { service: 'Facial', venueList: 'Aura and Zen' })).toBe(
      'Saved. Facial is up to date at Aura and Zen.',
    );
  });

  it('fills a placeholder used twice', () => {
    expect(collectiveCopy('reach.host.parked', { collective: 'Northside' })).toBe(
      'This service is not on the Northside page, so it is parked: nobody can book it while Northside is live. Bookings already made are not changed.',
    );
  });

  it('leaves a missing value visible rather than leaving a gap', () => {
    expect(collectiveCopy('svc.host.banner.title', {})).toContain('{collective}');
  });

  it('can fill every sentence in the deck, so none is written to be unfillable', () => {
    for (const id of ids) {
      const params = Object.fromEntries(collectiveCopyPlaceholders(id).map((key) => [key, 'X']));
      expect(collectiveCopy(id, params)).not.toMatch(/\{\w+\}/);
    }
  });
});

describe('formatVenueList', () => {
  it('reads as a sentence at every length', () => {
    expect(formatVenueList([])).toBe('');
    expect(formatVenueList(['Aura'])).toBe('Aura');
    expect(formatVenueList(['Aura', 'Zen'])).toBe('Aura and Zen');
    expect(formatVenueList(['Aura', 'Zen', 'Bloom'])).toBe('Aura, Zen and Bloom');
    expect(formatVenueList(['Aura', 'Zen', 'Bloom', 'Clay'])).toBe('Aura, Zen and 2 more');
    expect(formatVenueList(['Aura', 'Zen', 'Bloom', 'Clay', 'Dune'])).toBe('Aura, Zen and 3 more');
  });

  it('ignores blanks a venue name never has', () => {
    expect(formatVenueList(['Aura', '  ', ''])).toBe('Aura');
  });
});
