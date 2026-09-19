import type { Story } from '@ladle/react';
import { SWRConfig } from 'swr';
import { AppRouterContext, type AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { PathnameContext, SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import { ReportsView } from './ReportsView';

/**
 * Settings → Reports → Overview, with what GET /api/venue/reports returned for
 * Plus 1 Staging on the dev DB for August 2026 (the bookings-made figures now
 * match the New bookings tab: 59, plus 3 waiting for payment).
 */
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
    { period_start: '2026-08-04', no_show_count: 0, confirmed_at_time_count: 2, rate_pct: 0 },
    { period_start: '2026-08-12', no_show_count: 1, confirmed_at_time_count: 4, rate_pct: 25 },
    { period_start: '2026-08-20', no_show_count: 0, confirmed_at_time_count: 5, rate_pct: 0 },
  ],
  report3_cancellation: {
    total_bookings_created: 59,
    cancelled_guest_initiated: 1,
    cancelled_team_initiated: 6,
    cancelled_auto: 0,
    cancellation_rate_pct: 11.86,
  },
  report4_deposit: { total_collected_pence: 4500, total_refunded_pence: 0, total_forfeited_pence: 0 },
  report5_table_utilisation: [],
  report7_appointment_insights: null,
  report8_baseline_metrics: null,
  report8_baseline_snapshot: null,
  report_by_booking_model: [],
  report_event_ticket_tiers: [],
  report_resource_utilisation: [],
  client_summary: null,
  booking_log_email_config: null,
  default_booking_log_email: 'owner@example.com',
};

const router = {
  back: () => {},
  forward: () => {},
  refresh: () => {},
  push: () => {},
  replace: () => {},
  prefetch: () => {},
} as unknown as AppRouterInstance;

function serveReports() {
  if (typeof window === 'undefined') return;
  const w = window as Window & { __reportsStubbed?: boolean };
  if (w.__reportsStubbed) return;
  w.__reportsStubbed = true;
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith('/api/venue/reports?')) {
      return new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json' } });
    }
    return realFetch(input, init);
  };
}

export const Overview: Story = () => {
  serveReports();
  return (
    <AppRouterContext.Provider value={router}>
      <PathnameContext.Provider value="/dashboard/settings">
        <SearchParamsContext.Provider value={new URLSearchParams('tab=reports')}>
          <SWRConfig value={{ provider: () => new Map() }}>
            <div className="mx-auto max-w-6xl bg-slate-50 p-6">
              <ReportsView
                bookingModel="unified_scheduling"
                terminology={{ client: 'Client', booking: 'Appointment', staff: 'Staff' }}
                venueId="plus-1"
                pricingTier="plus"
                subTabQueryKey="reportsTab"
              />
            </div>
          </SWRConfig>
        </SearchParamsContext.Provider>
      </PathnameContext.Provider>
    </AppRouterContext.Provider>
  );
};
