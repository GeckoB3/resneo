import { describe, expect, it } from 'vitest';
import { cn } from './cn';

describe('cn', () => {
  it('joins truthy class names', () => {
    expect(cn('a', false && 'b', 'c')).toBe('a c');
  });

  it('returns empty string when all falsy', () => {
    expect(cn(undefined, null, false)).toBe('');
  });
});
