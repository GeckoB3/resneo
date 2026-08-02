import { describe, expect, it } from 'vitest';
import { buildReviewRequestBlock } from './review-request-block';
import type { VenueEmailData } from './types';

const PLACE_URL = 'https://g.page/r/CbAbCdEfGhIjK/review';

const venue = (over: Partial<VenueEmailData> = {}): VenueEmailData => ({
  name: 'Plus 1',
  reply_to_email: 'hello@plus1.test',
  ...over,
});

describe('buildReviewRequestBlock', () => {
  it('renders nothing until a venue turns it on', () => {
    expect(buildReviewRequestBlock(venue({ google_review_url: PLACE_URL }))).toBeNull();
  });

  it('renders nothing when enabled without a usable link', () => {
    expect(buildReviewRequestBlock(venue({ review_request_enabled: true }))).toBeNull();
    expect(
      buildReviewRequestBlock(
        venue({ review_request_enabled: true, google_review_url: 'https://www.google.com/maps/place/Plus+1' }),
      ),
    ).toBeNull();
  });

  it('offers the Google link and the direct route together, never one or the other', () => {
    const block = buildReviewRequestBlock(
      venue({ review_request_enabled: true, google_review_url: PLACE_URL }),
    )!;
    expect(block.html).toContain(PLACE_URL);
    expect(block.html).toContain('mailto:hello@plus1.test');
    expect(block.textLines.join('\n')).toContain(PLACE_URL);
    expect(block.textLines.join('\n')).toContain('hello@plus1.test');
  });

  it('carries no rating control, which would make it review gating', () => {
    const block = buildReviewRequestBlock(
      venue({ review_request_enabled: true, google_review_url: PLACE_URL }),
    )!;
    expect(block.html).not.toMatch(/star|rating|rate us/i);
  });

  it('names the practitioner when we know who delivered the service', () => {
    const block = buildReviewRequestBlock(
      venue({ review_request_enabled: true, google_review_url: PLACE_URL }),
      { practitionerName: 'Andrew' },
    )!;
    expect(block.html).toContain('your appointment with Andrew');
    expect(block.textLines.join('\n')).toContain('your appointment with Andrew');
  });

  it('falls back to neutral wording with no practitioner', () => {
    const block = buildReviewRequestBlock(
      venue({ review_request_enabled: true, google_review_url: PLACE_URL }),
    )!;
    expect(block.html).toContain('We hope you enjoyed your visit.');
  });

  it('escapes a practitioner name rather than injecting it raw', () => {
    const block = buildReviewRequestBlock(
      venue({ review_request_enabled: true, google_review_url: PLACE_URL }),
      { practitionerName: '<script>x</script>' },
    )!;
    expect(block.html).not.toContain('<script>');
    expect(block.html).toContain('&lt;script&gt;');
  });

  it('omits the direct route when the venue has no reply-to address', () => {
    const block = buildReviewRequestBlock(
      venue({ review_request_enabled: true, google_review_url: PLACE_URL, reply_to_email: null }),
    )!;
    expect(block.html).not.toContain('mailto:');
    expect(block.html).toContain(PLACE_URL);
  });

  it('normalises a pasted Place ID into a working link', () => {
    const block = buildReviewRequestBlock(
      venue({ review_request_enabled: true, google_review_url: 'ChIJN1t_tDeuEmsRUsoyG83frY4' }),
    )!;
    expect(block.html).toContain('https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4');
  });
});
