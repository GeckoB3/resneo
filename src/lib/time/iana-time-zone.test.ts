import { describe, it, expect } from 'vitest';
import {
  canFormatInTimeZone,
  isValidIanaTimeZone,
  resolveDisplayTimeZone,
  supportedTimeZones,
} from '@/lib/time/iana-time-zone';
import { toIsoWithOffset } from '@/lib/venue/venue-local-clock';

describe('isValidIanaTimeZone (writes)', () => {
  it('accepts real zones', () => {
    for (const tz of ['Europe/London', 'Australia/Sydney', 'America/Los_Angeles', 'UTC']) {
      expect(isValidIanaTimeZone(tz), tz).toBe(true);
    }
  });

  it('REJECTS the shapes a free-text field actually collects (G23)', () => {
    // 'GMT+1' is the one named in the plan. Intl rejects it outright, so a row
    // carrying it took down every page that formatted a date.
    for (const bad of ['GMT+1', 'EST5EDT+1', 'Europe/Lundon', 'london', '', '   ', null, undefined]) {
      expect(isValidIanaTimeZone(bad as string), String(bad)).toBe(false);
    }
  });

  it('is stricter than what Intl will merely tolerate', () => {
    // Intl accepts 'GMT' and legacy aliases; the canonical list does not. New
    // rows should only ever hold a name that appears in the picker.
    expect(canFormatInTimeZone('GMT')).toBe(true);
    expect(isValidIanaTimeZone('GMT')).toBe(false);
  });

  it('offers a list a select can be built from', () => {
    const zones = supportedTimeZones();
    expect(zones.length).toBeGreaterThan(100);
    expect(zones).toContain('Europe/London');
    expect([...zones]).toEqual([...zones].sort());
  });
});

describe('resolveDisplayTimeZone (reads)', () => {
  it('keeps a value already stored, including a legacy alias', () => {
    expect(resolveDisplayTimeZone('Europe/London')).toBe('Europe/London');
    // Not in the canonical list, but Intl formats in it, and a stored value
    // must not be silently rewritten on read.
    expect(resolveDisplayTimeZone('GMT')).toBe('GMT');
  });

  it('DEGRADES rather than throwing on a value that cannot format', () => {
    // The whole point: a customer who saved 'GMT+1' before validation existed
    // must still be able to load the profile page that lets them fix it.
    expect(resolveDisplayTimeZone('GMT+1')).toBe('Europe/London');
    expect(resolveDisplayTimeZone('GMT+1', 'Australia/Sydney')).toBe('Australia/Sydney');
    expect(resolveDisplayTimeZone(null)).toBe('Europe/London');
    expect(resolveDisplayTimeZone('  ', 'nonsense/zone')).toBe('Europe/London');
  });
});

describe('toIsoWithOffset', () => {
  it('carries the venue offset rather than rendering in UTC (C10)', () => {
    // A client reading 2026-06-15T08:00:00Z has to know the venue's zone to
    // learn the appointment is at 18:00 local. This form does not.
    const utcMs = Date.parse('2026-06-15T08:00:00Z');
    expect(toIsoWithOffset(utcMs, 'Australia/Sydney')).toBe('2026-06-15T18:00:00+10:00');
    expect(toIsoWithOffset(utcMs, 'America/Los_Angeles')).toBe('2026-06-15T01:00:00-07:00');
    expect(toIsoWithOffset(utcMs, 'Europe/London')).toBe('2026-06-15T09:00:00+01:00');
  });

  it('uses Z for a zero offset, and handles a half-hour one', () => {
    expect(toIsoWithOffset(Date.parse('2026-01-15T12:00:00Z'), 'Europe/London')).toBe(
      '2026-01-15T12:00:00Z',
    );
    expect(toIsoWithOffset(Date.parse('2026-06-15T08:00:00Z'), 'Asia/Kolkata')).toBe(
      '2026-06-15T13:30:00+05:30',
    );
  });

  it('reads the offset at the instant, so DST is per booking day', () => {
    expect(toIsoWithOffset(Date.parse('2026-01-15T12:00:00Z'), 'Europe/London')).toContain('Z');
    expect(toIsoWithOffset(Date.parse('2026-07-15T12:00:00Z'), 'Europe/London')).toContain('+01:00');
  });

  it('round-trips back to the same instant', () => {
    for (const tz of ['Australia/Sydney', 'America/Los_Angeles', 'Asia/Kolkata', 'Europe/London']) {
      const utcMs = Date.parse('2026-06-15T08:00:00Z');
      expect(Date.parse(toIsoWithOffset(utcMs, tz)), tz).toBe(utcMs);
    }
  });
});
