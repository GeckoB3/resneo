import { describe, expect, it } from 'vitest';
import { maskPiiForPrompt } from '@/lib/import/ai-map-columns';

describe('maskPiiForPrompt', () => {
  it('masks the local part of an email but keeps the domain shape', () => {
    expect(maskPiiForPrompt('jane.doe@example.com')).toBe('j***@example.com');
    expect(maskPiiForPrompt('a@b.co.uk')).toBe('a***@b.co.uk');
  });

  it('masks phone numbers, keeping only the last 2-3 digits', () => {
    // 12 digits -> 9 masked + last 3
    expect(maskPiiForPrompt('+44 7725 002233')).toBe('*********233');
    // 11 digits -> 8 masked + last 3
    expect(maskPiiForPrompt('(028) 9012 3456')).toBe('********456');
    expect(maskPiiForPrompt('07700900123')).toBe('********123');
  });

  it('keeps phone masking purely numeric (separators are dropped, not masked)', () => {
    const masked = maskPiiForPrompt('+44 7725 002233');
    expect(masked).not.toContain('+');
    expect(masked).not.toContain(' ');
    expect(masked.endsWith('233')).toBe(true);
    // last-N kept, rest are asterisks: no real leading digits leak
    expect(/^\*+\d{2,3}$/.test(masked)).toBe(true);
  });

  it('leaves names and other text untouched (needed for split detection)', () => {
    expect(maskPiiForPrompt('Jane Doe')).toBe('Jane Doe');
    expect(maskPiiForPrompt('Smith, John')).toBe('Smith, John');
    expect(maskPiiForPrompt('VIP')).toBe('VIP');
    expect(maskPiiForPrompt('Gents Cut')).toBe('Gents Cut');
  });

  it('leaves dates, times and plain numbers untouched', () => {
    expect(maskPiiForPrompt('14/03/2026')).toBe('14/03/2026');
    expect(maskPiiForPrompt('2:30 PM')).toBe('2:30 PM');
    expect(maskPiiForPrompt('2026-03-14 14:30')).toBe('2026-03-14 14:30');
    // short digit strings (not phone-length) are left as-is
    expect(maskPiiForPrompt('12345')).toBe('12345');
  });

  it('returns empty/whitespace values unchanged', () => {
    expect(maskPiiForPrompt('')).toBe('');
    expect(maskPiiForPrompt('   ')).toBe('   ');
  });
});
