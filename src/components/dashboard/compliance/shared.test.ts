import { describe, expect, it } from 'vitest';
import { formatComplianceDate } from '@/components/dashboard/compliance/shared';

describe('formatComplianceDate', () => {
  it('formats a bare calendar date as DD/MM/YYYY (no timezone shift)', () => {
    expect(formatComplianceDate('2026-06-01')).toBe('01/06/2026');
    expect(formatComplianceDate('2026-12-25')).toBe('25/12/2026');
  });

  it('formats an ISO timestamp as DD/MM/YYYY', () => {
    // Day can shift with the runner's timezone; assert the DD/MM/YYYY shape + year.
    expect(formatComplianceDate('2026-06-01T12:00:00.000Z')).toMatch(/^\d{2}\/\d{2}\/2026$/);
  });

  it('returns a dash for empty / invalid input', () => {
    expect(formatComplianceDate(null)).toBe('–');
    expect(formatComplianceDate(undefined)).toBe('–');
    expect(formatComplianceDate('not-a-date')).toBe('–');
  });
});
