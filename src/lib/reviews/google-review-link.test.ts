import { describe, expect, it } from 'vitest';
import {
  buildGoogleReviewUrlFromPlaceId,
  hasUsableGoogleReviewLink,
  normaliseGoogleReviewUrl,
} from './google-review-link';

const PLACE_ID = 'ChIJN1t_tDeuEmsRUsoyG83frY4';

describe('normaliseGoogleReviewUrl', () => {
  it('turns a bare Place ID into the write-review link', () => {
    expect(normaliseGoogleReviewUrl(PLACE_ID)).toBe(
      `https://search.google.com/local/writereview?placeid=${PLACE_ID}`,
    );
  });

  it('accepts a write-review link and returns it canonicalised', () => {
    expect(
      normaliseGoogleReviewUrl(
        `https://search.google.com/local/writereview?placeid=${PLACE_ID}&hl=en-GB`,
      ),
    ).toBe(`https://search.google.com/local/writereview?placeid=${PLACE_ID}`);
  });

  it('accepts a g.page review short link', () => {
    expect(normaliseGoogleReviewUrl('https://g.page/r/CbAbCdEfGhIjK/review')).toBe(
      'https://g.page/r/CbAbCdEfGhIjK/review',
    );
  });

  it('completes a g.page link that is missing the /review suffix', () => {
    expect(normaliseGoogleReviewUrl('https://g.page/r/CbAbCdEfGhIjK')).toBe(
      'https://g.page/r/CbAbCdEfGhIjK/review',
    );
  });

  it('tolerates a missing scheme and a www prefix', () => {
    expect(normaliseGoogleReviewUrl('www.g.page/r/CbAbCdEfGhIjK/review')).toBe(
      'https://g.page/r/CbAbCdEfGhIjK/review',
    );
  });

  it('rejects a Maps place link, which names the business but opens no review box', () => {
    expect(
      normaliseGoogleReviewUrl('https://www.google.com/maps/place/Plus+1/@54.6,-5.8,17z'),
    ).toBeNull();
  });

  it('rejects a Maps cid link, which cannot be converted to a review target', () => {
    expect(normaliseGoogleReviewUrl('https://maps.google.com/?cid=1234567890')).toBeNull();
  });

  it('rejects a g.page profile link that is not a review link', () => {
    expect(normaliseGoogleReviewUrl('https://g.page/plus-one-salon')).toBeNull();
  });

  it('rejects a write-review link whose placeid is missing or too short to be real', () => {
    expect(normaliseGoogleReviewUrl('https://search.google.com/local/writereview')).toBeNull();
    expect(normaliseGoogleReviewUrl('https://search.google.com/local/writereview?placeid=abc')).toBeNull();
  });

  it('rejects empty, whitespace and junk', () => {
    expect(normaliseGoogleReviewUrl(null)).toBeNull();
    expect(normaliseGoogleReviewUrl('   ')).toBeNull();
    expect(normaliseGoogleReviewUrl('not a link')).toBeNull();
    expect(normaliseGoogleReviewUrl('javascript:alert(1)')).toBeNull();
  });

  it('rejects a lookalike host', () => {
    expect(
      normaliseGoogleReviewUrl(`https://search.google.com.evil.test/local/writereview?placeid=${PLACE_ID}`),
    ).toBeNull();
  });
});

describe('hasUsableGoogleReviewLink', () => {
  it('gates the settings save on something that will actually work', () => {
    expect(hasUsableGoogleReviewLink(PLACE_ID)).toBe(true);
    expect(hasUsableGoogleReviewLink('https://www.google.com/maps/place/Plus+1')).toBe(false);
  });
});

describe('buildGoogleReviewUrlFromPlaceId', () => {
  it('encodes the id', () => {
    expect(buildGoogleReviewUrlFromPlaceId('a b')).toBe(
      'https://search.google.com/local/writereview?placeid=a%20b',
    );
  });
});
