import { describe, it, expect } from 'vitest';
import { rekeyRows } from '@/lib/import/ai-reshape-dataset';

const FIXED = ['Appointment Date', 'Appointment Time', 'Staff', 'Client Name', 'Service Name'];

describe('rekeyRows (cross-chunk column alignment)', () => {
  it('returns rows unchanged when columns exactly match', () => {
    const rows = [['2026-06-20', '09:30', 'Norah', 'Gary Stoops', 'Short Haircut']];
    expect(rekeyRows(FIXED, rows, FIXED)).toEqual(rows);
  });

  it('recovers a drifted column name ("Service Name" -> "Service")', () => {
    const drifted = ['Appointment Date', 'Appointment Time', 'Staff', 'Client Name', 'Service'];
    const rows = [['2026-06-20', '09:30', 'Norah', 'Gary Stoops', 'Short Haircut']];
    // Without tolerant matching the last column would be dropped (the real bug).
    expect(rekeyRows(drifted, rows, FIXED)).toEqual([
      ['2026-06-20', '09:30', 'Norah', 'Gary Stoops', 'Short Haircut'],
    ]);
  });

  it('falls back to position when every name is renamed but the count matches', () => {
    const renamed = ['Date', 'Time', 'Staff', 'Client', 'Svc'];
    const rows = [['2026-06-20', '09:30', 'Norah', 'Gary Stoops', 'Short Haircut']];
    expect(rekeyRows(renamed, rows, FIXED)).toEqual([
      ['2026-06-20', '09:30', 'Norah', 'Gary Stoops', 'Short Haircut'],
    ]);
  });

  it('re-keys by name when the model reorders the columns', () => {
    const reordered = ['Service Name', 'Staff', 'Appointment Date', 'Appointment Time', 'Client Name'];
    const rows = [['Short Haircut', 'Norah', '2026-06-20', '09:30', 'Gary Stoops']];
    expect(rekeyRows(reordered, rows, FIXED)).toEqual([
      ['2026-06-20', '09:30', 'Norah', 'Gary Stoops', 'Short Haircut'],
    ]);
  });

  it('leaves a genuinely missing column empty (different count, no match)', () => {
    const missing = ['Appointment Date', 'Appointment Time', 'Staff', 'Client Name'];
    const rows = [['2026-06-20', '09:30', 'Norah', 'Gary Stoops']];
    expect(rekeyRows(missing, rows, FIXED)).toEqual([
      ['2026-06-20', '09:30', 'Norah', 'Gary Stoops', ''],
    ]);
  });
});
