/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { DataExportSection, filenameFromDisposition, presetRange } from './DataExportSection';

const fetchMock = vi.fn();

function renderSection(props: Partial<React.ComponentProps<typeof DataExportSection>> = {}) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <DataExportSection isAppointment clientLabel="Client" bookingWord="Appointment" {...props} />
    </SWRConfig>,
  );
}

function countResponse(count: number) {
  return new Response(JSON.stringify({ count }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes('count=1')) return countResponse(url.includes('type=services') ? 4 : 142);
    return new Response(new Blob(['a,b']), {
      status: 200,
      headers: { 'Content-Disposition': 'attachment; filename="sept-salon-appointments-all-time-2026-09-19.csv"' },
    });
  });
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('DataExportSection', () => {
  it('counts what the choice covers and names it on the button', async () => {
    renderSection();
    await waitFor(() => expect(screen.getByTestId('export-count')).toHaveTextContent('142 appointments in total.'));
    expect(screen.getByRole('button', { name: /Download appointments as CSV/ })).toBeEnabled();
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/venue/export?type=bookings&count=1');
  });

  it('re-counts when the kind, the dates or the file type change', async () => {
    renderSection();
    await waitFor(() => expect(screen.getByTestId('export-count')).toHaveTextContent('142 appointments'));

    fireEvent.click(screen.getByRole('radio', { name: 'Services' }));
    await waitFor(() => expect(screen.getByTestId('export-count')).toHaveTextContent('4 services in total.'));
    expect(screen.getByText(/Services are chosen by the day they were added/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: 'This month' }));
    await waitFor(() => expect(screen.getByTestId('export-count')).toHaveTextContent('4 services in these dates.'));
    const thisMonth = presetRange('this_month')!;
    expect(fetchMock.mock.calls.at(-1)![0]).toBe(`/api/venue/export?type=services&from=${thisMonth.from}&to=${thisMonth.to}&count=1`);

    fireEvent.click(screen.getByRole('radio', { name: 'PDF' }));
    expect(screen.getByRole('button', { name: /Download services as PDF/ })).toBeEnabled();
    expect(screen.getByText(/For reading or printing/)).toBeInTheDocument();
  });

  it('asks for both custom dates before it will count or download, and refuses a backwards range', async () => {
    renderSection();
    fireEvent.click(screen.getByRole('radio', { name: 'Custom dates' }));
    expect(screen.getByTestId('export-count')).toHaveTextContent('Choose a From and a To date.');
    expect(screen.getByRole('button', { name: /Download appointments/ })).toBeDisabled();

    const [from, to] = screen.getAllByDisplayValue('') as HTMLInputElement[];
    fireEvent.change(from!, { target: { value: '2026-09-30' } });
    fireEvent.change(to!, { target: { value: '2026-09-01' } });
    expect(screen.getByTestId('export-count')).toHaveTextContent('The From date must be on or before the To date.');

    fireEvent.change(to!, { target: { value: '2026-10-01' } });
    await waitFor(() => expect(screen.getByTestId('export-count')).toHaveTextContent('142 appointments in these dates.'));
    expect(fetchMock.mock.calls.at(-1)![0]).toBe('/api/venue/export?type=bookings&from=2026-09-30&to=2026-10-01&count=1');
  });

  it('greys the button out when there is nothing in the range', async () => {
    fetchMock.mockImplementation(async () => countResponse(0));
    renderSection();
    await waitFor(() => expect(screen.getByTestId('export-count')).toHaveTextContent('No appointments yet.'));
    expect(screen.getByRole('button', { name: /Download appointments/ })).toBeDisabled();
  });

  it('downloads the chosen file type under the name the server gave it, then says so', async () => {
    const flash = vi.fn();
    renderSection({ onExportFlash: flash });
    await waitFor(() => expect(screen.getByRole('button', { name: /Download appointments as CSV/ })).toBeEnabled());
    fireEvent.click(screen.getByRole('radio', { name: 'Excel spreadsheet' }));

    const clicks: string[] = [];
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      clicks.push(this.download);
    };
    try {
      fireEvent.click(screen.getByRole('button', { name: /Download appointments as Excel spreadsheet/ }));
      await waitFor(() => expect(flash).toHaveBeenCalledWith('success', expect.stringContaining('Excel spreadsheet is downloading')));
    } finally {
      HTMLAnchorElement.prototype.click = realClick;
    }
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/venue/export?type=bookings&format=xlsx')).toBe(true);
    expect(clicks).toEqual(['sept-salon-appointments-all-time-2026-09-19.csv']);
  });

  it('reports a refusal instead of downloading an error page', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('count=1')
        ? countResponse(3)
        : new Response(JSON.stringify({ error: 'Forbidden: admin only' }), { status: 403 }),
    );
    const flash = vi.fn();
    renderSection({ onExportFlash: flash });
    await waitFor(() => expect(screen.getByRole('button', { name: /Download appointments as CSV/ })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /Download appointments as CSV/ }));
    await waitFor(() => expect(flash).toHaveBeenCalledWith('notice', 'Forbidden: admin only'));
  });
});

describe('presetRange', () => {
  it('covers whole months and years on the local calendar', () => {
    const today = new Date(2026, 8, 19); // 19 September 2026
    expect(presetRange('all', today)).toBeNull();
    expect(presetRange('this_month', today)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(presetRange('last_month', today)).toEqual({ from: '2026-08-01', to: '2026-08-31' });
    expect(presetRange('this_year', today)).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(presetRange('last_year', today)).toEqual({ from: '2025-01-01', to: '2025-12-31' });
    // January's "last month" is December of the year before.
    expect(presetRange('last_month', new Date(2026, 0, 5))).toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });
});

describe('filenameFromDisposition', () => {
  it('reads the quoted and unquoted forms and falls back when the header is missing', () => {
    expect(filenameFromDisposition('attachment; filename="a-b.xlsx"', 'x.csv')).toBe('a-b.xlsx');
    expect(filenameFromDisposition('attachment; filename=a-b.pdf', 'x.csv')).toBe('a-b.pdf');
    expect(filenameFromDisposition(null, 'x.csv')).toBe('x.csv');
  });
});
