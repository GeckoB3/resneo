import { describe, expect, it } from 'vitest';
import { escapeIlikeLiteral } from './name-match';

describe('escapeIlikeLiteral', () => {
  it('escapes literal % wildcards', () => {
    expect(escapeIlikeLiteral('20% off')).toBe('20\\% off');
  });

  it('escapes literal _ wildcards', () => {
    expect(escapeIlikeLiteral('cal_main')).toBe('cal\\_main');
  });

  it('escapes backslashes', () => {
    expect(escapeIlikeLiteral('a\\b')).toBe('a\\\\b');
  });

  it('leaves plain values untouched', () => {
    expect(escapeIlikeLiteral('Main calendar')).toBe('Main calendar');
  });
});
