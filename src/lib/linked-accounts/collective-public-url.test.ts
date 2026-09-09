import { describe, expect, it } from 'vitest';
import { collectivePublicPath, collectivePublicUrl } from './collective-public-url';

const members = [
  { venueId: 'v-host', venueSlug: 'plus-1-venue' },
  { venueId: 'v-member', venueSlug: 'light-3' },
  { venueId: 'v-blank', venueSlug: null },
];

describe('collectivePublicPath', () => {
  it('uses the dedicated address by default', () => {
    expect(collectivePublicPath({ slug: 'plus-1', slugStrategy: 'dedicated', adoptedVenueId: null, members })).toBe(
      '/book/c/plus-1',
    );
  });

  it('uses the adopted member’s own address', () => {
    expect(
      collectivePublicPath({ slug: 'plus-1', slugStrategy: 'adopt_member', adoptedVenueId: 'v-member', members }),
    ).toBe('/book/light-3');
  });

  it('falls back to the dedicated address when the adopted member has no slug or is gone', () => {
    expect(
      collectivePublicPath({ slug: 'plus-1', slugStrategy: 'adopt_member', adoptedVenueId: 'v-blank', members }),
    ).toBe('/book/c/plus-1');
    expect(
      collectivePublicPath({ slug: 'plus-1', slugStrategy: 'adopt_member', adoptedVenueId: 'v-gone', members }),
    ).toBe('/book/c/plus-1');
  });

  it('prefixes the origin it is given', () => {
    expect(
      collectivePublicUrl(
        { slug: 'plus-1', slugStrategy: 'dedicated', adoptedVenueId: null, members },
        'https://app.resneo.com',
      ),
    ).toBe('https://app.resneo.com/book/c/plus-1');
  });
});
