'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, LineChart, Line, CartesianGrid,
} from 'recharts';
import { DataExportSection } from './DataExportSection';
import { ClientsSection, type ClientSummary } from './ClientsSection';
import type { BookingModel, VenueTerminology } from '@/types/booking-models';
import { isAppointmentDashboardExperience, isUnifiedSchedulingVenue } from '@/lib/booking/unified-scheduling';
import type { DashboardStatColor } from '@/components/dashboard/dashboard-stat-types';
import { PageHeader } from '@/components/ui/dashboard/PageHeader';
import { TabBar } from '@/components/ui/dashboard/TabBar';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import { Pill } from '@/components/ui/dashboard/Pill';
import { StatTile } from '@/components/ui/dashboard/StatTile';
import { EmptyState } from '@/components/ui/dashboard/EmptyState';
import { DashboardChartSkeleton } from '@/components/ui/dashboard/DashboardSkeletons';

interface Report1 {
  total_bookings_created: number;
  by_source: Record<string, number>;
  by_status: Record<string, number>;
  covers_booked: number;
  covers_seated: number;
}

interface Report2Row {
  period_start: string;
  no_show_count: number;
  confirmed_at_time_count: number;
  rate_pct: number;
}

interface Report3 {
  total_bookings_created: number;
  cancelled_guest_initiated: number;
  cancelled_auto: number;
  cancellation_rate_pct: number;
}

interface Report4 {
  total_collected_pence: number;
  total_refunded_pence: number;
  total_forfeited_pence: number;
}

interface AppointmentInsightsPayload {
  by_practitioner: Array<{
    practitioner_id: string;
    practitioner_name: string;
    booking_count: number;
    completed_count: number;
  }>;
  by_service: Array<{
    service_id: string;
    service_name: string;
    booking_count: number;
  }>;
  by_booking_source: Record<string, number>;
}

interface ReportByBookingModelRow {
  booking_model: BookingModel;
  label: string;
  booking_count: number;
  covers: number;
  cancelled_count: number;
  completed_count: number;
  checked_in_count: number;
  deposit_pence_collected: number;
}

interface ReportsData {
  from: string;
  to: string;
  booking_model?: BookingModel;
  pricing_tier?: string | null;
  enabled_models?: BookingModel[];
  table_management_enabled?: boolean;
  report1_booking_summary: Report1 | null;
  report2_no_show_series: Report2Row[];
  report3_cancellation: Report3 | null;
  report4_deposit: Report4 | null;
  report5_table_utilisation?: Array<{
    table_id: string;
    table_name: string;
    utilisation_pct: number;
    occupied_hours: number;
    available_hours: number;
  }>;
  report7_appointment_insights?: AppointmentInsightsPayload | null;
  /** Inferred from booking row FKs - same labels as full export (plan §4.3). */
  report_by_booking_model?: ReportByBookingModelRow[];
  client_summary?: ClientSummary | null;
  booking_log_email_config?: BookingLogEmailConfig | null;
  default_booking_log_email?: string | null;
}

interface BookingLogEmailScheduleEntry {
  day: number;
  time: string;
}

interface BookingLogEmailConfig {
  enabled: boolean;
  recipient_email: string | null;
  schedule: BookingLogEmailScheduleEntry[];
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DEFAULT_LOG_SCHEDULE: BookingLogEmailScheduleEntry[] = [
  { day: 1, time: '17:00' },
  { day: 2, time: '17:00' },
  { day: 3, time: '17:00' },
  { day: 4, time: '17:00' },
  { day: 5, time: '17:00' },
];

/** Brand-aligned chart segments: brand-600, brand-400, emerald-500, amber-500, slate. */
const COLORS = ['#4E6B78', '#6B8A9A', '#059669', '#f59e0b', '#d97706', '#64748b'];

function last7Days(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 7);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

type ExportFlash = { variant: 'success' | 'notice'; message: string };

function formatBookingSourceLabel(source: string): string {
  const map: Record<string, string> = {
    online: 'Online',
    phone: 'Phone',
    'walk-in': 'Walk-in',
    widget: 'Website widget',
    booking_page: 'Booking page',
  };
  return map[source] ?? source;
}

function reportMetricColor(accent?: string): DashboardStatColor {
  if (!accent) return 'slate';
  if (accent === 'teal') return 'brand';
  if (accent === 'emerald') return 'emerald';
  if (accent === 'amber') return 'amber';
  if (accent === 'red') return 'amber';
  return 'slate';
}

/** Merge raw event source keys onto display labels (matches pie + CSV). */
function aggregateBookingSourcesByLabel(bySource: Record<string, number>): Array<{ name: string; value: number }> {
  const acc = new Map<string, number>();
  for (const [k, v] of Object.entries(bySource)) {
    const label = formatBookingSourceLabel(k);
    acc.set(label, (acc.get(label) ?? 0) + v);
  }
  return [...acc.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}

async function fetchReportsJson(url: string): Promise<ReportsData> {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to load');
  return res.json() as Promise<ReportsData>;
}

function normalizeLogConfig(config: BookingLogEmailConfig | null | undefined, fallbackEmail?: string | null): BookingLogEmailConfig {
  return {
    enabled: config?.enabled === true,
    recipient_email: config?.recipient_email ?? fallbackEmail ?? '',
    schedule: config?.schedule?.length ? config.schedule : DEFAULT_LOG_SCHEDULE,
  };
}

export interface ReportsViewProps {
  bookingModel: BookingModel;
  terminology: VenueTerminology;
  venueId: string;
  /** Fallback before SWR resolves (matches `venues.pricing_tier`). */
  pricingTier?: string | null;
}

export function ReportsView({ bookingModel, terminology, venueId, pricingTier = null }: ReportsViewProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [range, setRange] = useState(last7Days);
  const [appliedRange, setAppliedRange] = useState(last7Days);
  const reportsUrl = `/api/venue/reports?from=${appliedRange.from}&to=${appliedRange.to}`;
  const {
    data,
    error: swrError,
    isLoading,
    isValidating,
    mutate,
  } = useSWR(reportsUrl, fetchReportsJson, {
    revalidateOnFocus: false,
    dedupingInterval: 60_000,
    keepPreviousData: true,
  });
  const error = swrError ? (swrError instanceof Error ? swrError.message : 'Error') : null;
  const resolvedBookingModel = useMemo(
    () => (data?.booking_model as BookingModel | undefined) ?? bookingModel,
    [data?.booking_model, bookingModel],
  );
  const appointmentDashboardExperience = useMemo(
    () =>
      isAppointmentDashboardExperience(
        (data?.pricing_tier as string | null | undefined) ?? pricingTier ?? null,
        resolvedBookingModel,
        data?.enabled_models ?? null,
      ),
    [data?.pricing_tier, data?.enabled_models, pricingTier, resolvedBookingModel],
  );
  const [exportFlash, setExportFlash] = useState<ExportFlash | null>(null);
  const activeTab = searchParams.get('tab') === 'clients' ? 'clients' : 'overview';

  const setActiveTab = useCallback(
    (tab: 'overview' | 'clients') => {
      const p = new URLSearchParams(searchParams.toString());
      if (tab === 'clients') p.set('tab', 'clients');
      else p.delete('tab');
      const qs = p.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const dismissExportFlashSoon = useCallback(() => {
    window.setTimeout(() => setExportFlash(null), 4500);
  }, []);

  const notifyExport = useCallback(
    (variant: ExportFlash['variant'], message: string) => {
      setExportFlash({ variant, message });
      dismissExportFlashSoon();
    },
    [dismissExportFlashSoon],
  );

  const applyRange = useCallback(() => {
    setAppliedRange(range);
  }, [range]);

  const exportReport1 = useCallback(() => {
    if (!data?.report1_booking_summary) return;
    const r = data.report1_booking_summary;
    const model = (data.booking_model as BookingModel | undefined) ?? bookingModel;
    const appt = isAppointmentDashboardExperience(
      (data.pricing_tier as string | null | undefined) ?? pricingTier ?? null,
      model,
      data.enabled_models ?? null,
    );
    downloadCsv(`report1-booking-summary-${data.from}-${data.to}.csv`, [
      ['Metric', 'Value'],
      [
        appt ? `${terminology.booking}s created in period` : 'Total bookings created',
        String(r.total_bookings_created),
      ],
      [
        appt
          ? `Total ${terminology.client.toLowerCase()} places booked (headcount)`
          : 'Covers booked',
        String(r.covers_booked),
      ],
      [
        appt
          ? `${terminology.client}s arrived, seated, or completed (headcount)`
          : 'Covers seated',
        String(r.covers_seated),
      ],
      ['By source (created)', ''],
      ...aggregateBookingSourcesByLabel(r.by_source).map(({ name, value }) => [name, String(value)]),
      ['By status', ''],
      ...Object.entries(r.by_status).map(([k, v]) => [k, String(v)]),
    ]);
  }, [data, bookingModel, terminology, pricingTier]);

  const exportReport2 = useCallback(() => {
    if (!data?.report2_no_show_series?.length) return;
    const model = (data.booking_model as BookingModel | undefined) ?? bookingModel;
    const appt = isAppointmentDashboardExperience(
      (data.pricing_tier as string | null | undefined) ?? pricingTier ?? null,
      model,
      data.enabled_models ?? null,
    );
    const headerRow = appt
      ? ['Date', 'No-shows', 'Attended or no-show (count)', 'Rate %']
      : ['Date', 'No-shows', 'Denominator', 'Rate %'];
    downloadCsv(`report2-no-show-rate-${data.from}-${data.to}.csv`, [
      headerRow,
      ...data.report2_no_show_series.map((row) => [row.period_start, String(row.no_show_count), String(row.confirmed_at_time_count), String(row.rate_pct)]),
    ]);
  }, [data, bookingModel, pricingTier]);

  const exportReport3 = useCallback(() => {
    if (!data?.report3_cancellation) return;
    const r = data.report3_cancellation;
    const model = (data.booking_model as BookingModel | undefined) ?? bookingModel;
    const appt = isAppointmentDashboardExperience(
      (data.pricing_tier as string | null | undefined) ?? pricingTier ?? null,
      model,
      data.enabled_models ?? null,
    );
    downloadCsv(`report3-cancellation-${data.from}-${data.to}.csv`, [
      ['Metric', 'Value'],
      [
        appt ? `${terminology.booking}s created in period` : 'Total bookings created',
        String(r.total_bookings_created),
      ],
      [
        appt
          ? `Cancelled (${terminology.client.toLowerCase()}-initiated)`
          : 'Cancelled (guest-initiated)',
        String(r.cancelled_guest_initiated),
      ],
      ['Cancelled (auto)', String(r.cancelled_auto)],
      ['Cancellation rate %', String(r.cancellation_rate_pct)],
    ]);
  }, [data, bookingModel, terminology, pricingTier]);

  const exportReport4 = useCallback(() => {
    if (!data?.report4_deposit) return;
    const r = data.report4_deposit;
    downloadCsv(`report4-deposit-${data.from}-${data.to}.csv`, [
      ['Metric', 'Pence', 'GBP'],
      ['Total collected', String(r.total_collected_pence), (r.total_collected_pence / 100).toFixed(2)],
      ['Total refunded', String(r.total_refunded_pence), (r.total_refunded_pence / 100).toFixed(2)],
      ['Total forfeited', String(r.total_forfeited_pence), (r.total_forfeited_pence / 100).toFixed(2)],
    ]);
  }, [data]);

  const exportReport5 = useCallback(() => {
    if (!data?.report5_table_utilisation?.length) return;
    downloadCsv(`report5-table-utilisation-${data.from}-${data.to}.csv`, [
      ['Table', 'Utilisation %', 'Occupied hours', 'Available hours'],
      ...data.report5_table_utilisation.map((row) => [
        row.table_name,
        String(row.utilisation_pct),
        String(row.occupied_hours),
        String(row.available_hours),
      ]),
    ]);
  }, [data]);

  const exportReport7 = useCallback(() => {
    if (!data?.report7_appointment_insights) return;
    const r = data.report7_appointment_insights;
    const bookingPlural = `${terminology.booking}s`;
    downloadCsv(`report7-appointment-insights-${data.from}-${data.to}.csv`, [
      [terminology.staff, bookingPlural, 'Arrived or completed'],
      ...r.by_practitioner.map((row) => [
        row.practitioner_name,
        String(row.booking_count),
        String(row.completed_count),
      ]),
      [],
      ['Service', bookingPlural],
      ...r.by_service.map((row) => [row.service_name, String(row.booking_count)]),
      [],
      ['Channel', `${bookingPlural} in period`],
      ...aggregateBookingSourcesByLabel(r.by_booking_source).map(({ name, value }) => [name, String(value)]),
    ]);
  }, [data, terminology]);

  const reportTabs = useMemo(
    () =>
      [
        { id: 'overview' as const, label: 'Overview' },
        { id: 'clients' as const, label: `${terminology.client}s` },
      ] as const,
    [terminology.client],
  );

  if (isLoading && !data) {
    return <DashboardChartSkeleton kpiCount={4} />;
  }

  if (error) {
    return (
      <EmptyState
        title="Could not load reports"
        description={error}
        action={
          <button
            type="button"
            onClick={() => void mutate()}
            className="text-sm font-semibold text-brand-600 hover:text-brand-700"
          >
            Retry
          </button>
        }
      />
    );
  }

  const r1 = data?.report1_booking_summary;
  const r2 = data?.report2_no_show_series ?? [];
  const r3 = data?.report3_cancellation;
  const r4 = data?.report4_deposit;
  const r5 = data?.report5_table_utilisation ?? [];
  const r7 = data?.report7_appointment_insights;

  const client = terminology.client;
  const clientLower = client.toLowerCase();
  const bookingWord = terminology.booking;
  const staffWord = terminology.staff;

  const sourcePieData = r1?.by_source ? aggregateBookingSourcesByLabel(r1.by_source) : [];
  const statusBarData = r1?.by_status ? Object.entries(r1.by_status).map(([source, count]) => ({ source, count })) : [];
  const noShowRateOverall = r2.length > 0
    ? (r2.reduce((a, d) => a + d.no_show_count, 0) / Math.max(1, r2.reduce((a, d) => a + d.confirmed_at_time_count, 0))) * 100
    : 0;

  const pracPerformanceData = (r7?.by_practitioner ?? []).map((row) => ({
    key: row.practitioner_id,
    shortName:
      row.practitioner_name.length > 20
        ? `${row.practitioner_name.slice(0, 18)}…`
        : row.practitioner_name,
    fullName: row.practitioner_name,
    bookings: row.booking_count,
    completed: row.completed_count,
  }));

  const svcVolumeData = (r7?.by_service ?? []).map((row) => ({
    key: row.service_id,
    name:
      row.service_name.length > 28
        ? `${row.service_name.slice(0, 26)}…`
        : row.service_name,
    fullName: row.service_name,
    count: row.booking_count,
  }));

  const channelPieData = r7?.by_booking_source ? aggregateBookingSourcesByLabel(r7.by_booking_source) : [];

  const hasAppointmentInsights =
    pracPerformanceData.length > 0 || svcVolumeData.length > 0 || channelPieData.length > 0;

  return (
    <div className="space-y-6">
      {exportFlash && (
        <div
          role="status"
          aria-live="polite"
          className={`flex flex-wrap items-center gap-2 rounded-2xl border px-4 py-3 text-sm ${
            exportFlash.variant === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-amber-200 bg-amber-50 text-amber-900'
          }`}
        >
          <Pill variant={exportFlash.variant === 'success' ? 'success' : 'warning'} size="sm" dot>
            {exportFlash.variant === 'success' ? 'Export' : 'Notice'}
          </Pill>
          <span>{exportFlash.message}</span>
        </div>
      )}

      <PageHeader
        eyebrow="Insights"
        title="Reports"
        subtitle={
          appointmentDashboardExperience
            ? 'Appointment analytics for your team, services, and channels. Figures use the selected date range unless noted.'
            : 'Covers, deposits, and guest trends for your venue. Figures use the selected date range unless noted.'
        }
        actions={<TabBar tabs={reportTabs} value={activeTab} onChange={setActiveTab} />}
      />

      <SectionCard elevated>
        <SectionCard.Header eyebrow="Range" title="Date range" />
        <SectionCard.Body className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <span className="font-medium text-slate-600">From</span>
            <input
              type="date"
              value={range.from}
              onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm shadow-sm"
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <span className="font-medium text-slate-600">To</span>
            <input
              type="date"
              value={range.to}
              onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm shadow-sm"
            />
          </label>
          <button
            type="button"
            onClick={applyRange}
            disabled={isValidating}
            className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
          >
            {isValidating ? 'Loading...' : 'Apply'}
          </button>
        </SectionCard.Body>
      </SectionCard>

      {activeTab === 'clients' && data ? (
        <ClientsSection
          venueId={venueId}
          terminology={terminology}
          bookingModel={resolvedBookingModel}
          appointmentDashboardExperience={appointmentDashboardExperience}
          clientSummary={data.client_summary ?? null}
          rangeLabel={`${data.from} → ${data.to}`}
          onReportsRefresh={() => void mutate()}
        />
      ) : null}

      {activeTab === 'overview' && (
        <>
      {/* Report 1 */}
      <ReportSection
        title={appointmentDashboardExperience ? 'Appointment activity' : 'Booking summary'}
        onExport={exportReport1}
        exportBlocked={!r1}
        exportBlockedMessage={
          appointmentDashboardExperience
            ? 'There is no appointment activity to export for this period.'
            : 'There is no booking summary to export for this period.'
        }
        onExportSuccess={() =>
          notifyExport(
            'success',
            `${appointmentDashboardExperience ? 'Appointment activity' : 'Booking summary'} CSV download started - check your downloads folder.`,
          )
        }
        onExportBlocked={(msg) => notifyExport('notice', msg)}
      >
        {r1 ? (
          <>
            {appointmentDashboardExperience && (
              <p className="mb-4 text-sm text-slate-500">
                Headcount comes from party size on each {bookingWord.toLowerCase()}: the middle figure is total{' '}
                <strong>{clientLower} places</strong> booked in range (each person in a group counts once). The
                right-hand figure is how many of those places reached arrived, seated, or completed status.
              </p>
            )}
            <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <StatTile
                label={appointmentDashboardExperience ? `${bookingWord}s created` : `Total ${bookingWord.toLowerCase()}s`}
                value={String(r1.total_bookings_created)}
                color={reportMetricColor('teal')}
              />
              <StatTile
                label={
                  appointmentDashboardExperience
                    ? `${client} places booked`
                    : 'Covers booked'
                }
                value={String(r1.covers_booked)}
                color={reportMetricColor('teal')}
              />
              <StatTile
                label={
                  appointmentDashboardExperience
                    ? `${client}s seen (arrived / completed)`
                    : 'Covers seated'
                }
                value={String(r1.covers_seated)}
                color={reportMetricColor('emerald')}
              />
            </div>
            <div className="grid gap-6 md:grid-cols-2">
              <div className="h-64">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  {appointmentDashboardExperience ? 'How they booked (when created)' : 'By source (when created)'}
                </p>
                {sourcePieData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={sourcePieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={(e) => `${e.name}: ${e.value}`}>
                        {sourcePieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                ) : <p className="text-sm text-slate-400">No data</p>}
              </div>
              <div className="h-64">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  {appointmentDashboardExperience ? 'Appointment status (latest)' : 'By status (latest)'}
                </p>
                {statusBarData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={statusBarData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="source" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Bar dataKey="count" fill="#4E6B78" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : <p className="text-sm text-slate-400">No data</p>}
              </div>
            </div>
          </>
        ) : (
          <p className="text-sm text-slate-400">No activity data for this range yet.</p>
        )}
        {appointmentDashboardExperience ? (
          <div className="mt-8">
            <BookingLogEmailSettingsPanel
              config={data?.booking_log_email_config ?? null}
              defaultEmail={data?.default_booking_log_email ?? null}
              onSaved={() => void mutate()}
            />
          </div>
        ) : null}
      </ReportSection>

      {appointmentDashboardExperience && (
        <ReportSection
          title="Team, services & channels"
          onExport={exportReport7}
          exportBlocked={!hasAppointmentInsights}
          exportBlockedMessage="There is no appointment breakdown to export for this period."
          onExportSuccess={() =>
            notifyExport('success', 'Team & services report CSV download started - check your downloads folder.')
          }
          onExportBlocked={(msg) => notifyExport('notice', msg)}
        >
          <p className="mb-4 text-sm text-slate-500">
            Non-cancelled {bookingWord.toLowerCase()}s in this date range, counting only appointment scheduling (table
            dining and other non-appointment types are excluded). Volume is split by calendar or legacy practitioner (staff),
            by linked service (appointment service or unified service item), and booking source. The &quot;Arrived or
            completed&quot; bar includes marked arrival, started, or completed visits.
          </p>
          {!r7 || (pracPerformanceData.length === 0 && svcVolumeData.length === 0 && channelPieData.length === 0) ? (
            <p className="text-sm text-slate-400">
              No appointment data in this range yet. After {bookingWord.toLowerCase()}s are created, you will see
              performance by {staffWord.toLowerCase()} and service here.
            </p>
          ) : (
            <div className="space-y-8">
              {pracPerformanceData.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                    By {staffWord.toLowerCase()}
                  </p>
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={pracPerformanceData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis dataKey="shortName" tick={{ fontSize: 11 }} interval={0} angle={-25} textAnchor="end" height={70} />
                        <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                        <Tooltip formatter={(value: number, name: string) => [value, name]} />
                        <Legend />
                        <Bar dataKey="bookings" name={`${bookingWord}s`} fill="#4E6B78" radius={[6, 6, 0, 0]} />
                        <Bar
                          dataKey="completed"
                          name="Arrived or completed"
                          fill="#059669"
                          radius={[6, 6, 0, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
              {svcVolumeData.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Top services by volume
                  </p>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        layout="vertical"
                        data={svcVolumeData}
                        margin={{ top: 8, right: 24, left: 8, bottom: 8 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                        <XAxis type="number" tick={{ fontSize: 12 }} allowDecimals={false} />
                        <YAxis
                          type="category"
                          dataKey="name"
                          width={120}
                          tick={{ fontSize: 11 }}
                        />
                        <Tooltip formatter={(value: number) => [value, `${bookingWord}s`]} />
                        <Bar dataKey="count" fill="#4E6B78" radius={[0, 6, 6, 0]} name={`${bookingWord}s`} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
              {channelPieData.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                    How {clientLower}s booked (channel mix)
                  </p>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={channelPieData}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          outerRadius={88}
                          label={(e) => `${e.name}: ${e.value}`}
                        >
                          {channelPieData.map((_, i) => (
                            <Cell key={i} fill={COLORS[i % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </div>
          )}
        </ReportSection>
      )}

      {/* Report 2 */}
      <ReportSection
        title="No-show rate"
        onExport={exportReport2}
        exportBlocked={r2.length === 0}
        exportBlockedMessage="There is no no-show rate data to export for this period."
        onExportSuccess={() => notifyExport('success', 'No-show rate CSV download started - check your downloads folder.')}
        onExportBlocked={(msg) => notifyExport('notice', msg)}
      >
        {appointmentDashboardExperience && (
          <p className="mb-3 text-sm text-slate-500">
            {client}s who confirmed an online {bookingWord.toLowerCase()} but did not attend (walk-ins excluded from
            the denominator). Use this to track reliability and follow-up.
          </p>
        )}
        <p className="mb-3 text-sm text-slate-500">
          Overall: <span className="font-semibold text-slate-900">{noShowRateOverall.toFixed(1)}%</span>
        </p>
        {r2.length > 0 ? (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={r2} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="period_start" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                <Tooltip formatter={(value: number) => [`${value}%`, 'Rate']} />
                <Line type="monotone" dataKey="rate_pct" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} name="No-show %" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : <p className="text-sm text-slate-400">No data for this period</p>}
      </ReportSection>

      {/* Report 3 */}
      <ReportSection
        title="Cancellation rate"
        onExport={exportReport3}
        exportBlocked={!r3}
        exportBlockedMessage="There is no cancellation data to export for this period."
        onExportSuccess={() => notifyExport('success', 'Cancellation rate CSV download started - check your downloads folder.')}
        onExportBlocked={(msg) => notifyExport('notice', msg)}
      >
        {r3 && (
          <>
            {appointmentDashboardExperience && (
              <p className="mb-3 text-sm text-slate-500">
                Auto (unpaid) counts {bookingWord.toLowerCase()}s that moved from Pending to Cancelled - for example
                when a required deposit was not completed in time.
              </p>
            )}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile
                label={appointmentDashboardExperience ? `${bookingWord}s created` : 'Total created'}
                value={String(r3.total_bookings_created)}
                color={reportMetricColor()}
              />
              <StatTile
                label={appointmentDashboardExperience ? `${client}-initiated` : 'Guest-initiated'}
                value={String(r3.cancelled_guest_initiated)}
                color={reportMetricColor()}
              />
              <StatTile label="Auto (unpaid)" value={String(r3.cancelled_auto)} color={reportMetricColor()} />
              <StatTile
                label="Cancellation rate"
                value={`${r3.cancellation_rate_pct}%`}
                color={reportMetricColor(r3.cancellation_rate_pct > 10 ? 'red' : 'emerald')}
              />
            </div>
          </>
        )}
      </ReportSection>

      {/* Report 4 */}
      <ReportSection
        title={appointmentDashboardExperience ? 'Payments & deposits' : 'Deposit summary'}
        onExport={exportReport4}
        exportBlocked={!r4}
        exportBlockedMessage={
          appointmentDashboardExperience ? 'There is no payment summary to export for this period.' : 'There is no deposit summary to export for this period.'
        }
        onExportSuccess={() =>
          notifyExport(
            'success',
            `${appointmentDashboardExperience ? 'Payment' : 'Deposit'} summary CSV download started - check your downloads folder.`,
          )
        }
        onExportBlocked={(msg) => notifyExport('notice', msg)}
      >
        {r4 && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatTile
              label="Total collected"
              value={`£${(r4.total_collected_pence / 100).toFixed(2)}`}
              color={reportMetricColor('emerald')}
            />
            <StatTile
              label="Total refunded"
              value={`£${(r4.total_refunded_pence / 100).toFixed(2)}`}
              color={reportMetricColor('amber')}
            />
            <StatTile
              label="Total forfeited"
              value={`£${(r4.total_forfeited_pence / 100).toFixed(2)}`}
              color={reportMetricColor('red')}
            />
          </div>
        )}
      </ReportSection>

      {!isUnifiedSchedulingVenue(resolvedBookingModel) && data?.table_management_enabled && (
        <ReportSection
          title="Table utilisation"
          onExport={exportReport5}
          exportBlocked={r5.length === 0}
          exportBlockedMessage="There is no table utilisation data to export for this period."
          onExportSuccess={() => notifyExport('success', 'Table utilisation CSV download started - check your downloads folder.')}
          onExportBlocked={(msg) => notifyExport('notice', msg)}
        >
          {r5.length > 0 ? (
            <div className="space-y-2">
              {r5.map((row) => (
                <div key={row.table_id} className="rounded-lg border border-slate-100 bg-slate-50/50 p-3">
                  <div className="mb-1 flex items-center justify-between">
                    <p className="text-sm font-medium text-slate-800">{row.table_name}</p>
                    <p className={`text-sm font-semibold ${
                      row.utilisation_pct < 50 ? 'text-amber-700' : row.utilisation_pct > 90 ? 'text-emerald-700' : 'text-slate-700'
                    }`}>
                      {row.utilisation_pct}%
                    </p>
                  </div>
                  <div className="h-2 rounded-full bg-slate-200">
                    <div
                      className={`h-2 rounded-full ${
                        row.utilisation_pct < 50 ? 'bg-amber-500' : row.utilisation_pct > 90 ? 'bg-emerald-500' : 'bg-brand-500'
                      }`}
                      style={{ width: `${Math.min(100, row.utilisation_pct)}%` }}
                    />
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">
                    {row.occupied_hours}h occupied / {row.available_hours}h available
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400">No table utilisation data for this range.</p>
          )}
        </ReportSection>
      )}

      <DataExportSection
        onExportFlash={notifyExport}
        isAppointment={appointmentDashboardExperience}
        clientLabel={client}
        bookingWord={bookingWord}
      />
        </>
      )}
    </div>
  );
}

function BookingLogEmailSettingsPanel({
  config,
  defaultEmail,
  onSaved,
}: {
  config: BookingLogEmailConfig | null;
  defaultEmail: string | null;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<BookingLogEmailConfig>(() => normalizeLogConfig(config, defaultEmail));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    setDraft(normalizeLogConfig(config, defaultEmail));
  }, [config, defaultEmail]);

  const setDayEnabled = (day: number, enabled: boolean) => {
    setDraft((current) => {
      const exists = current.schedule.some((entry) => entry.day === day);
      if (enabled && !exists) {
        return {
          ...current,
          schedule: [...current.schedule, { day, time: '17:00' }].sort((a, b) => a.day - b.day),
        };
      }
      if (!enabled) {
        return { ...current, schedule: current.schedule.filter((entry) => entry.day !== day) };
      }
      return current;
    });
  };

  const setDayTime = (day: number, time: string) => {
    setDraft((current) => ({
      ...current,
      schedule: current.schedule.map((entry) => (entry.day === day ? { ...entry, time } : entry)),
    }));
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const payload = {
        enabled: draft.enabled,
        recipient_email: draft.recipient_email?.trim() ? draft.recipient_email.trim() : null,
        schedule: draft.schedule,
      };
      const res = await fetch('/api/venue/reports/booking-log-email', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || 'Failed to save booking log email settings');
      }
      setMessage({ tone: 'success', text: 'Daily booking log settings saved.' });
      onSaved();
    } catch (err) {
      setMessage({
        tone: 'error',
        text: err instanceof Error ? err.message : 'Failed to save booking log email settings',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`mb-6 rounded-2xl border p-4 shadow-sm transition-colors ${draft.enabled ? 'border-emerald-200 bg-gradient-to-br from-emerald-50 to-white' : 'border-slate-200 bg-slate-50/60'}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <p className="text-sm font-semibold text-slate-900">Daily booking log email</p>
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${draft.enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${draft.enabled ? 'bg-emerald-500' : 'bg-slate-400'}`} />
              {draft.enabled ? 'On' : 'Off'}
            </span>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">Send a summary of new appointments and cancellations.</p>
        </div>
        <label className={`inline-flex shrink-0 cursor-pointer items-center gap-2.5 rounded-full px-3 py-2 text-sm font-semibold shadow-sm ring-1 transition-colors ${draft.enabled ? 'bg-emerald-600 text-white ring-emerald-600 hover:bg-emerald-700' : 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50'}`}>
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.checked }))}
            className="sr-only"
          />
          <span className={`flex h-5 w-9 items-center rounded-full transition-colors ${draft.enabled ? 'bg-white/30' : 'bg-slate-200'}`}>
            <span className={`h-4 w-4 rounded-full bg-white shadow transition-transform ${draft.enabled ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
          </span>
          {draft.enabled ? 'Enabled' : 'Disabled'}
        </label>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Send to</span>
          <input
            type="email"
            value={draft.recipient_email ?? ''}
            onChange={(event) => setDraft((current) => ({ ...current, recipient_email: event.target.value }))}
            placeholder={defaultEmail ?? 'admin@example.com'}
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
          />
        </label>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Schedule</p>
          <div className="mt-1 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {DAY_LABELS.map((label, day) => {
              const entry = draft.schedule.find((item) => item.day === day);
              return (
                <div key={label} className="rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
                  <label className="flex items-center justify-between gap-2 text-sm font-medium text-slate-700">
                    <span className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={Boolean(entry)}
                        onChange={(event) => setDayEnabled(day, event.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                      />
                      {label}
                    </span>
                  </label>
                  <input
                    type="time"
                    value={entry?.time ?? '17:00'}
                    disabled={!entry}
                    onChange={(event) => setDayTime(day, event.target.value)}
                    className="mt-2 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm disabled:bg-slate-50 disabled:text-slate-400"
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        {message ? (
          <p className={`text-sm ${message.tone === 'success' ? 'text-emerald-700' : 'text-rose-700'}`}>
            {message.text}
          </p>
        ) : (
          <p className="text-xs text-slate-500">Emails are off by default and only send on selected days.</p>
        )}
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="inline-flex items-center justify-center rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save email settings'}
        </button>
      </div>
    </div>
  );
}

function ReportSection({
  title,
  onExport,
  exportBlocked,
  exportBlockedMessage,
  onExportSuccess,
  onExportBlocked,
  children,
}: {
  title: string;
  onExport: () => void;
  exportBlocked?: boolean;
  exportBlockedMessage?: string;
  onExportSuccess: () => void;
  onExportBlocked: (message: string) => void;
  children: React.ReactNode;
}) {
  const blocked = Boolean(exportBlocked);
  const blockedHint = exportBlockedMessage ?? 'Nothing to export for this report.';

  const handleExportClick = () => {
    if (blocked) {
      onExportBlocked(blockedHint);
      return;
    }
    onExport();
    onExportSuccess();
  };

  return (
    <SectionCard elevated>
      <SectionCard.Header
        eyebrow="Report"
        title={title}
        right={
          <button
            type="button"
            onClick={handleExportClick}
            title={blocked ? blockedHint : 'Download this report as a CSV file'}
            aria-label={blocked ? `Export CSV: ${blockedHint}` : 'Export CSV'}
            className={`flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 ${
              blocked
                ? 'text-slate-400 hover:bg-slate-50 hover:text-slate-600'
                : 'text-brand-600 hover:bg-brand-50 hover:text-brand-700'
            }`}
          >
            <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            Export CSV
          </button>
        }
      />
      <SectionCard.Body>{children}</SectionCard.Body>
    </SectionCard>
  );
}
