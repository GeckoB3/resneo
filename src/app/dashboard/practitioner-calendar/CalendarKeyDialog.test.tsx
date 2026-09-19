/** @vitest-environment happy-dom */
/** The diary's colour key names every closed-stripe tint the grid draws, for own and linked columns alike. */
import { describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { CALENDAR_KEY_ENTRIES, CalendarKeyDialog } from './CalendarKeyDialog';

describe('CalendarKeyDialog', () => {
  it('lists the five stripe kinds with their meanings', () => {
    render(<CalendarKeyDialog open onClose={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'What the colours mean' })).toBeInTheDocument();
    for (const entry of CALENDAR_KEY_ENTRIES) {
      expect(screen.getByText(entry.label)).toBeInTheDocument();
    }
    expect(CALENDAR_KEY_ENTRIES.map((e) => e.label)).toEqual([
      'Venue closed',
      'Calendar unavailable',
      'Closed, Unavailable or On leave',
      'Calendar closed',
      'Break',
    ]);
  });
});
