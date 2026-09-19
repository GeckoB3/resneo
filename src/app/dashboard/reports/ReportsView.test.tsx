/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { ReportsView } from './ReportsView';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/dashboard/settings',
}));

/** Plus 1 Staging, August 2026, as GET /api/venue/reports now answers it. */
const payload = {
  from: '2026-08-01',
  to: '2026-08-31',
  booking_model: 'unified_scheduling',
  pricing_tier: 'plus',
  enabled_models: ['unified_scheduling'],
  table_management_enabled: false,
  report1_booking_summary: {
    total_bookings_created: 59,
    by_source: { phone: 32, booking_page: 26, 'walk-in': 1 },
    by_channel: { online: 26, team: 31, walk_in: 1, linked_venue: 1 },
    by_status: { Booked: 39, Completed: 7, Seated: 2, Cancelled: 7, Pending: 3, Confirmed: 4 },
    covers_booked: 59,
    covers_seated: 10,
  },
  report2_no_show_series: [
    { period_start: '2026-08-12', no_show_count: 1, confirmed_at_time_count: 4, rate_pct: 25 },
  ],
  report3_cancellation: {
    total_bookings_created: 59,
    cancelled_guest_initiated: 1,
    cancelled_team_initiated: 6,
    cancelled_auto: 0,
    cancellation_rate_pct: 11.86,
  },
  report4_deposit: { total_collected_pence: 0, total_refunded_pence: 0, total_forfeited_pence: 0 },
  report5_table_utilisation: [],
  report7_appointment_insights: null,
  report8_baseline_metrics: null,
  report8_baseline_snapshot: null,
  report_by_booking_model: [],
  report_event_ticket_tiers: [],
  report_resource_utilisation: [],
  client_summary: null,
  booking_log_email_config: null,
  default_booking_log_email: null,
};

const csvFiles: string[] = [];

beforeEach(() => {
  csvFiles.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => payload }) as Response),
  );
  const RealBlob = globalThis.Blob;
  vi.stubGlobal(
    'Blob',
    class extends RealBlob {
      constructor(parts: BlobPart[], options?: BlobPropertyBag) {
        super(parts, options);
        csvFiles.push(parts.map(String).join(''));
      }
    },
  );
  URL.createObjectURL = vi.fn(() => 'blob:report');
  URL.revokeObjectURL = vi.fn();
  // The download link is clicked, not followed.
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderView() {
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ReportsView
        bookingModel="unified_scheduling"
        terminology={{ client: 'Client', booking: 'Appointment', staff: 'Staff' }}
        venueId="venue-1"
        pricingTier="plus"
        subTabQueryKey="reportsTab"
      />
    </SWRConfig>,
  );
}

/** Every stat tile with this label, in page order (a card title with the same words is skipped). */
function tiles(label: string): HTMLElement[] {
  return screen
    .getAllByText(label)
    .map((el) => el.closest('div.\\@container') as HTMLElement | null)
    .filter((el): el is HTMLElement => el != null);
}
const tile = (label: string) => tiles(label)[0]!;

describe('ReportsView Overview', () => {
  it('shows the New bookings count on Appointment activity, with the bookings waiting for payment beside it', async () => {
    renderView();
    await screen.findAllByText('Appointments created');
    // Appointment activity first, then Cancellation rate: the same count on both.
    const [activityCreated, cancellationCreated] = tiles('Appointments created');
    expect(within(activityCreated!).getByText('59')).toBeInTheDocument();
    expect(within(activityCreated!).getByText('+3 waiting for payment')).toBeInTheDocument();
    expect(within(cancellationCreated!).getByText('59')).toBeInTheDocument();
    expect(within(tile('Client places booked')).getByText('59')).toBeInTheDocument();
    expect(within(tile('Clients seen (arrived / completed)')).getByText('10')).toBeInTheDocument();
    expect(screen.getByText(/same count as the New bookings tab/)).toBeInTheDocument();
  });

  it('splits cancellations by who made them, with lapses beside the rate', async () => {
    renderView();
    await screen.findAllByText('Appointments created');
    expect(within(tile('Client-initiated')).getByText('1')).toBeInTheDocument();
    expect(within(tile('Team-initiated')).getByText('6')).toBeInTheDocument();
    expect(within(tile('Cancellation rate')).getByText('11.86%')).toBeInTheDocument();
    expect(within(tile('Auto (unpaid)')).getByText('0')).toBeInTheDocument();
    expect(screen.getByText(/the share since cancelled by the client or by your team/)).toBeInTheDocument();
  });

  it('exports the channels in the New bookings words, and the waiting count', async () => {
    renderView();
    await screen.findAllByText('Appointments created');
    // The first report card on Overview is Appointment activity.
    fireEvent.click(screen.getAllByRole('button', { name: 'Export CSV' })[0]!);
    const csv = csvFiles[0] ?? '';
    expect(csv).toContain('"Appointments created in period","59"');
    expect(csv).toContain('"Waiting for payment (not in the total)","3"');
    expect(csv).toContain('"By your team","31"');
    expect(csv).toContain('"Online","26"');
    expect(csv).toContain('"By a linked venue","1"');
    expect(csv).not.toContain('"Phone"');
  });
});
