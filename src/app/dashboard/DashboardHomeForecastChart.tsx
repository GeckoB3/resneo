'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export interface ForecastRow {
  date: string;
  day: string;
  covers: number;
  bookings: number;
}

export function DashboardHomeForecastChart({
  forecast,
  isAppointment,
  /** When set, draws the bookings series with this noun (tooltip / legend). Overrides appointment copy. */
  bookingsSeriesLabel,
}: {
  forecast: ForecastRow[];
  isAppointment: boolean;
  bookingsSeriesLabel?: string;
}) {
  const useBookings = isAppointment || Boolean(bookingsSeriesLabel);
  const tooltipParts = (value: number): [string, string] => {
    if (bookingsSeriesLabel) {
      return [`${value} bookings`, bookingsSeriesLabel];
    }
    if (isAppointment) {
      return [`${value} appointments`, 'Appointments'];
    }
    return [`${value} covers`, 'Covers'];
  };
  return (
    <div className="h-52 min-h-0 min-w-0 w-full max-w-full">
      <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
        <BarChart data={forecast} margin={{ top: 4, right: 4, left: -8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
          <XAxis
            dataKey="day"
            tick={{ fontSize: 12, fill: '#64748b' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 12, fill: '#94a3b8' }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
          />
          <Tooltip
            contentStyle={{
              borderRadius: '0.75rem',
              border: '1px solid #e2e8f0',
              fontSize: '12px',
              boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.05)',
            }}
            formatter={(value: number) => tooltipParts(value)}
            cursor={{ fill: '#f8fafc' }}
          />
          <Bar
            dataKey={useBookings ? 'bookings' : 'covers'}
            fill="#4E6B78"
            radius={[8, 8, 0, 0]}
            maxBarSize={44}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
