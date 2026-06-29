import { describe, it, expect } from 'vitest';
import { escapeLikePattern } from './like-escape';

describe('escapeLikePattern', () => {
  it('escapes LIKE wildcards so an email matches literally', () => {
    expect(escapeLikePattern('john_doe@example.com')).toBe('john\\_doe@example.com');
    expect(escapeLikePattern('a%b@example.com')).toBe('a\\%b@example.com');
    expect(escapeLikePattern('a\\b@example.com')).toBe('a\\\\b@example.com');
  });

  it('leaves an ordinary email unchanged', () => {
    expect(escapeLikePattern('owner@example.com')).toBe('owner@example.com');
  });

  it('escapes multiple wildcards in one value', () => {
    expect(escapeLikePattern('a_b%c@x.com')).toBe('a\\_b\\%c@x.com');
  });
});
