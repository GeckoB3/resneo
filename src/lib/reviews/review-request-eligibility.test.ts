import { describe, expect, it } from 'vitest';
import {
  REVIEW_REQUEST_INTERVAL_DAYS,
  reviewRequestIntervalElapsed,
  venueWithoutReviewRequest,
} from './review-request-eligibility';
import type { VenueEmailData } from '@/lib/emails/types';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 7, 2);

describe('reviewRequestIntervalElapsed', () => {
  it('allows the first ask', () => {
    expect(reviewRequestIntervalElapsed(null, NOW)).toBe(true);
    expect(reviewRequestIntervalElapsed(undefined, NOW)).toBe(true);
  });

  it('holds a regular back inside the six-month window', () => {
    const lastWeek = new Date(NOW - 7 * DAY_MS).toISOString();
    expect(reviewRequestIntervalElapsed(lastWeek, NOW)).toBe(false);
  });

  it('asks again once the window has passed', () => {
    const longAgo = new Date(NOW - (REVIEW_REQUEST_INTERVAL_DAYS + 1) * DAY_MS).toISOString();
    expect(reviewRequestIntervalElapsed(longAgo, NOW)).toBe(true);
  });

  it('treats the boundary itself as elapsed', () => {
    const exactly = new Date(NOW - REVIEW_REQUEST_INTERVAL_DAYS * DAY_MS).toISOString();
    expect(reviewRequestIntervalElapsed(exactly, NOW)).toBe(true);
  });

  it('does not block on an unparseable stamp', () => {
    expect(reviewRequestIntervalElapsed('not a date', NOW)).toBe(true);
  });
});

describe('venueWithoutReviewRequest', () => {
  it('turns the block off without disturbing the rest of the venue payload', () => {
    const venue: VenueEmailData = {
      name: 'Plus 1',
      reply_to_email: 'hello@plus1.test',
      google_review_url: 'https://g.page/r/CbAbCdEfGhIjK/review',
      review_request_enabled: true,
    };
    const suppressed = venueWithoutReviewRequest(venue);
    expect(suppressed.review_request_enabled).toBe(false);
    expect(suppressed.name).toBe('Plus 1');
    expect(suppressed.google_review_url).toBe(venue.google_review_url);
    expect(venue.review_request_enabled).toBe(true);
  });
});
