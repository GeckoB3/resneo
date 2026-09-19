/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { NewBookingsSection } from './NewBookingsSection';
import type { NewBookingCounts, NewBookingsReport } from '@/lib/reports/new-bookings';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

function counts(
  over: Omit<Partial<NewBookingCounts>, 'by_channel'> & { by_channel?: Partial<NewBookingCounts['by_channel']> } = {},
): NewBookingCounts {
  const { by_channel, ...rest } = over;
  return {
    total: 0,
    cancelled: 0,
    awaiting_payment: 0,
    ...rest,
    by_channel: { online: 0, team: 0, walk_in: 0, linked_venue: 0, ...by_channel },
  };
}

const report: NewBookingsReport = {
  from: '2026-09-14',
  to: '2026-09-15',
  grain: 'day',
  today: '2026-09-15',
  periods: [
    {
      period_start: '2026-09-14',
      period_end: '2026-09-14',
      ...counts({ total: 3, by_channel: { online: 2, team: 1 }, cancelled: 1 }),
    },
    {
      period_start: '2026-09-15',
      period_end: '2026-09-15',
      ...counts({ total: 1, by_channel: { walk_in: 1 }, awaiting_payment: 2 }),
    },
  ],
  totals: counts({ total: 4, by_channel: { online: 2, team: 1, walk_in: 1 }, cancelled: 1, awaiting_payment: 2 }),
};

/** Intl writes September as "Sep" or "Sept" depending on the ICU data. */
const RANGE_TITLE = /^New bookings, 14 Sept? to 15 Sept? 2026$/;

let served: NewBookingsReport | { error: string } = report;
let status = 200;
const requested: string[] = [];

beforeEach(() => {
  requested.length = 0;
  served = report;
  status = 200;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      requested.push(url);
      return { ok: status === 200, status, json: async () => served } as Response;
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

function renderSection(onExportNotice = vi.fn()) {
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <NewBookingsSection recharts={null} onExportNotice={onExportNotice} />
    </SWRConfig>,
  );
  return onExportNotice;
}

describe('NewBookingsSection', () => {
  it('asks for this week by day and shows the total, the channels and the table', async () => {
    renderSection();
    expect(await screen.findByText(RANGE_TITLE)).toBeInTheDocument();
    expect(requested[0]).toContain('preset=this_week');
    expect(requested[0]).toContain('grain=day');
    expect(screen.getByText('1 since cancelled')).toBeInTheDocument();
    expect(screen.getAllByText('50% of new bookings')).toHaveLength(1);
    expect(screen.getAllByText('25% of new bookings')).toHaveLength(2);
    // No linked venue booked in the range, so it gets no tile and no column.
    expect(screen.queryByText('By a linked venue')).not.toBeInTheDocument();
    expect(screen.getByText(/2 more bookings were made in these dates/)).toBeInTheDocument();

    const table = screen.getByRole('table', { name: /New bookings by period/ });
    const rows = within(table).getAllByRole('row');
    const cells = (row: HTMLElement) => within(row).getAllByRole('cell').map((c) => c.textContent);
    // Period, Online, By your team, Walk-ins, New bookings, Since cancelled.
    expect(cells(rows[1]!)).toEqual([expect.stringMatching(/^Mon 14 Sept?$/), '2', '1', '0', '3', '1']);
    expect(cells(rows[2]!)).toEqual([expect.stringMatching(/^Tue 15 Sept?Today$/), '0', '0', '1', '1', '0']);
    expect(cells(rows[3]!)).toEqual(['Total', '2', '1', '1', '4', '1']);
  });

  it('switches the range and the grain through the request', async () => {
    renderSection();
    await screen.findByText(RANGE_TITLE);
    fireEvent.click(screen.getByRole('button', { name: 'Last month' }));
    fireEvent.click(screen.getByRole('button', { name: 'Week' }));
    const last = requested[requested.length - 1] ?? '';
    expect(last).toContain('preset=last_month');
    expect(last).toContain('grain=week');
  });

  it('sends a custom range as dates', async () => {
    renderSection();
    await screen.findByText(RANGE_TITLE);
    fireEvent.click(screen.getByRole('button', { name: 'Custom range' }));
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-08-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-08-31' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    const last = requested[requested.length - 1] ?? '';
    expect(last).toContain('from=2026-08-01');
    expect(last).toContain('to=2026-08-31');
    expect(last).not.toContain('preset=');
  });

  it('shows the server message when a range is refused', async () => {
    served = { error: 'Choose a range of up to 400 days.' };
    status = 400;
    renderSection();
    expect(await screen.findByText('Choose a range of up to 400 days.')).toBeInTheDocument();
  });

  it('shows a linked venue once it has booked', async () => {
    served = {
      ...report,
      totals: counts({ total: 5, by_channel: { online: 2, team: 1, walk_in: 1, linked_venue: 1 } }),
    };
    renderSection();
    expect(await screen.findAllByText('By a linked venue')).toHaveLength(2);
  });
});
