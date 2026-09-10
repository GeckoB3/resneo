/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { BookedRevenueSection } from './BookedRevenueSection';
import type { BookedRevenueReport } from '@/lib/reports/booked-revenue';

const cell = (booked: number, noShow = 0, unpriced = 0) => ({
  booked_pence: booked,
  no_show_pence: noShow,
  booked_count: booked > 0 ? 1 : 0,
  no_show_count: noShow > 0 ? 1 : 0,
  unpriced_count: unpriced,
});

const report: BookedRevenueReport = {
  from: '2026-09-07',
  to: '2026-09-08',
  grain: 'day',
  today: '2026-09-08',
  columns: [
    { key: 'cal-a', calendar_id: 'cal-a', name: 'Anna', venue_id: 'v1', venue_name: 'Studio', linked: false, colour: '#111' },
    { key: 'cal-p', calendar_id: 'cal-p', name: 'Pat', venue_id: 'v2', venue_name: 'Partner Salon', linked: true, colour: null },
  ],
  periods: [
    {
      period_start: '2026-09-07',
      period_end: '2026-09-07',
      ...cell(8000, 2000),
      by_calendar: { 'cal-a': cell(3000, 2000), 'cal-p': cell(5000) },
    },
    {
      period_start: '2026-09-08',
      period_end: '2026-09-08',
      ...cell(4500),
      by_calendar: { 'cal-a': cell(4500) },
    },
  ],
  totals: { ...cell(12500, 2000), by_calendar: { 'cal-a': cell(7500, 2000), 'cal-p': cell(5000) } },
};

const requested: string[] = [];

beforeEach(() => {
  requested.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      requested.push(url);
      return { ok: true, json: async () => report } as Response;
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

function renderSection() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <BookedRevenueSection recharts={null} bookingWord="Appointment" onExportNotice={() => {}} />
    </SWRConfig>,
  );
}

describe('BookedRevenueSection', () => {
  it('asks for this week by day and shows booked revenue net of no-shows', async () => {
    renderSection();
    expect((await screen.findAllByText('£125.00')).length).toBeGreaterThan(0);
    expect(requested[0]).toContain('grain=day');
    expect(requested[0]).toContain('preset=this_week');
    expect(screen.getByText('No-shows deducted')).toBeInTheDocument();
    expect(screen.getAllByText('£20.00').length).toBeGreaterThan(0);
    // The linked calendar is labelled with its venue.
    expect(screen.getByText('Partner Salon')).toBeInTheDocument();
    expect(screen.getByText(/Includes calendars from Partner Salon/)).toBeInTheDocument();
  });

  it('adds no-shows back when asked, without another request', async () => {
    renderSection();
    await screen.findAllByText('£125.00');
    const before = requested.length;
    fireEvent.click(screen.getByLabelText('Include no-shows'));
    expect(screen.getAllByText('£145.00').length).toBeGreaterThan(0);
    expect(screen.getByText('No-shows included')).toBeInTheDocument();
    expect(requested.length).toBe(before);
  });

  it('switches the grain and preset through the request', async () => {
    renderSection();
    await screen.findAllByText('£125.00');
    fireEvent.click(screen.getByRole('button', { name: 'Month' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next 30 days' }));
    const last = requested[requested.length - 1] ?? '';
    expect(last).toContain('grain=month');
    expect(last).toContain('preset=next_30');
  });
});
