/**
 * P3-1: what a "Book again" link may and may not promise.
 *
 * The rule running through every case: the button says "book again", so it
 * must either carry the same choices over or not appear. A link that quietly
 * drops the service or the practitioner starts the customer over while
 * claiming to repeat their last visit, and they would have no way to tell
 * which of the two they got.
 */
import { describe, it, expect } from 'vitest';
import { rebookUrl } from './rebook-url';

describe('rebookUrl', () => {
  it('carries the venue, practitioner and service', () => {
    const url = rebookUrl({
      venueSlug: 'harbour-clinic',
      serviceItemId: 'svc-1',
      practitionerSlug: 'ada',
    });
    expect(url).toBe('/book/harbour-clinic/ada?service_id=svc-1&start=time');
  });

  it('asks to skip the service step, which is what makes it one tap', () => {
    // `start=service` would land them back on the list they already chose
    // from. `start=time` passes through it (and still stops at a variant or
    // an addon group, which the flow enforces, not this URL).
    expect(rebookUrl({ venueSlug: 'v', serviceItemId: 's', practitionerSlug: 'p' })).toContain(
      'start=time',
    );
  });

  it('works without a practitioner, for a venue that does not name one', () => {
    expect(rebookUrl({ venueSlug: 'v', serviceItemId: 's' })).toBe('/book/v?service_id=s&start=time');
  });

  it('offers the service step when it knows WHO but not WHAT', () => {
    // Still worth a link: the practitioner carries over and the service is
    // exactly what is unknown, so the service step is the honest landing.
    expect(rebookUrl({ venueSlug: 'v', practitionerSlug: 'p' })).toBe('/book/v/p?start=service');
  });

  it('returns null when it knows neither, rather than a bare booking page', () => {
    expect(rebookUrl({ venueSlug: 'v' })).toBeNull();
    expect(rebookUrl({ venueSlug: 'v', serviceItemId: '  ', practitionerSlug: '' })).toBeNull();
  });

  it('returns null with no venue, because there is no page to point at', () => {
    expect(rebookUrl({ venueSlug: null, serviceItemId: 's' })).toBeNull();
    expect(rebookUrl({ venueSlug: '   ', serviceItemId: 's' })).toBeNull();
  });

  it('escapes anything that would otherwise break out of the path', () => {
    // Slugs come from the database, not from a route, so this is defence in
    // depth rather than a known hostile input.
    const url = rebookUrl({
      venueSlug: 'a/b',
      practitionerSlug: 'c?d',
      serviceItemId: 'e&f=g',
    });
    expect(url).toBe('/book/a%2Fb/c%3Fd?service_id=e%26f%3Dg&start=time');
  });
});
