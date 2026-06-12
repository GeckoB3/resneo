import { describe, it, expect } from 'vitest';
import { detectIrregularGrid } from '@/lib/import/detect-irregular';

/** A paginated, report-style salon export: date headers + times listed beneath. */
function reportGrid(): string[][] {
  const grid: string[][] = [];
  const day = (date: string | null) => {
    if (date) grid.push([date, '', '']);
    grid.push(['Norah McNally', '', '']);
    grid.push(['Start Time', 'Client Name', 'Service Name']);
    grid.push(['09:30', 'Gary Stoops', 'Short Haircut']);
    grid.push(['10:00', 'Conor Clark', 'Short Haircut']);
    grid.push(['10:30', 'Ryan Strain', 'Child Cut']);
  };
  day(null); // first block has no date header
  grid.push(['Page 1', '', '']);
  day('12-May-26');
  grid.push(['Page 2', '', '']);
  day('13-May-26');
  grid.push(['Page 3', '', '']);
  day('14-May-26');
  return grid;
}

/** A clean platform export — one header row, then rectangular data. */
function cleanGrid(): string[][] {
  return [
    ['Client First Name', 'Client Last Name', 'Appointment Date', 'Appointment Time', 'Service Name', 'Staff Member'],
    ['Sarah', 'Jones', '14/03/2026', '09:30', 'Cut', 'Alice'],
    ['John', 'Smith', '14/03/2026', '10:00', 'Colour', 'Bob'],
    ['Mary', 'Doe', '15/03/2026', '11:00', 'Cut', 'Alice'],
    ['Tim', 'Lee', '15/03/2026', '12:00', 'Trim', 'Bob'],
    ['Ann', 'Fox', '16/03/2026', '09:00', 'Cut', 'Alice'],
  ];
}

describe('detectIrregularGrid', () => {
  it('flags a paginated report with date headers and times listed beneath', () => {
    const result = detectIrregularGrid(reportGrid(), { fileTypeHint: 'bookings' });
    expect(result.isIrregular).toBe(true);
    expect(result.signals.repeatedHeaderRowCount).toBeGreaterThanOrEqual(2);
    expect(result.signals.dateOnlyRowCount).toBeGreaterThanOrEqual(2);
    expect(result.signals.timeColumnDominant).toBe(true);
  });

  it('does NOT flag a clean rectangular export', () => {
    const result = detectIrregularGrid(cleanGrid(), { fileTypeHint: 'bookings' });
    expect(result.isIrregular).toBe(false);
    expect(result.reasons).toHaveLength(0);
  });

  it('does NOT flag a clean client list', () => {
    const grid: string[][] = [
      ['First Name', 'Last Name', 'Email', 'Mobile'],
      ['Sarah', 'Jones', 'sarah@example.com', '07700900001'],
      ['John', 'Smith', 'john@example.com', '07700900002'],
      ['Mary', 'Doe', 'mary@example.com', '07700900003'],
    ];
    expect(detectIrregularGrid(grid, { fileTypeHint: 'clients' }).isIrregular).toBe(false);
  });
});
