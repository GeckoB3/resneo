import { describe, expect, it } from 'vitest';
import { PLATFORM_MAPPINGS, detectPlatform } from '@/lib/import/constants';

describe('detectPlatform', () => {
  it('detects Fresha when enough signature columns match', () => {
    const headers = [
      'Client First Name',
      'Client Last Name',
      'Client Mobile',
      'Client Email',
      'Appointment Date',
      'Appointment Time',
      'Service Name',
      'Staff Member',
    ];
    const { platform } = detectPlatform(headers, 'export.csv');
    expect(platform).toBe('fresha');
  });

  it('returns unknown when few columns match', () => {
    const { platform } = detectPlatform(['A', 'B'], 'x.csv');
    expect(platform).toBe('unknown');
  });

  it('detects Phorest when signature columns match', () => {
    const headers = [
      'Appointment ID',
      'Client ID',
      'First Name',
      'Last Name',
      'Appointment Date',
      'Start Time',
      'Service Name',
      'Staff Name',
    ];
    const { platform } = detectPlatform(headers, 'export.csv');
    expect(platform).toBe('phorest');
  });

  it('detects Phorest from filename with partial column match', () => {
    const headers = ['First Name', 'Last Name', 'Email', 'Appointment Date', 'Start Time'];
    const { platform } = detectPlatform(headers, 'phorest_clients.csv');
    expect(platform).toBe('phorest');
  });

  it('maps surname aliases to last_name in platform templates', () => {
    expect(PLATFORM_MAPPINGS.phorest_clients?.Surname).toBe('last_name');
    expect(PLATFORM_MAPPINGS.vagaro_clients?.Surname).toBe('last_name');
    expect(PLATFORM_MAPPINGS.timely_clients?.['Client surname']).toBe('last_name');
  });
});
