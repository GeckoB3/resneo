'use client';

import { HelpTooltip } from '@/components/dashboard/HelpTooltip';
import { helpContent } from '@/lib/help-content';
import type { VenueServiceRow } from '@/app/dashboard/availability/service-settings-types';
import { DAY_LABELS } from '@/app/dashboard/availability/service-settings-types';

export const SERVICE_FIELD_CLASS =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100';

export function toggleDay(days: number[], day: number): number[] {
  return days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort();
}

export function formatServiceDays(days: number[]): string {
  if (days.length === 7) return 'Every day';
  if (days.join(',') === '1,2,3,4,5') return 'Weekdays';
  if (days.join(',') === '0,6') return 'Weekends';
  return days.map((day) => DAY_LABELS[day]).join(', ');
}

interface Props {
  /** Schedule fields; may include `id` when editing an existing row (ignored for fields). */
  data: Omit<VenueServiceRow, 'id'> | VenueServiceRow;
  onChange: (d: Omit<VenueServiceRow, 'id'>) => void;
}

export function ServiceBasicsForm({ data, onChange }: Props) {
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-brand-100 bg-brand-50/50 p-4">
        <label className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-slate-900">
          Service name <HelpTooltip content={helpContent.services.name} />
        </label>
        <p className="mb-3 text-xs leading-relaxed text-slate-600">
          This is what staff and guests use to recognise the bookable period.
        </p>
        <input
          type="text"
          value={data.name}
          onChange={(e) => onChange({ ...data, name: e.target.value })}
          className={SERVICE_FIELD_CLASS}
          placeholder="e.g. Lunch, Dinner, Sunday Brunch"
        />
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <label className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-slate-900">
          Days this service runs <HelpTooltip content={helpContent.services.daysOfWeek} />
        </label>
        <p className="mb-3 text-xs leading-relaxed text-slate-500">
          Select only the days guests should be able to book this service.
        </p>
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
          {DAY_LABELS.map((label, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onChange({ ...data, days_of_week: toggleDay(data.days_of_week, i) })}
              className={`rounded-xl px-3 py-2 text-xs font-semibold transition-colors ${
                data.days_of_week.includes(i)
                  ? 'bg-brand-600 text-white shadow-sm shadow-brand-600/20'
                  : 'bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <label className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-slate-900">
            First booking <HelpTooltip content={helpContent.services.startTime} />
          </label>
          <p className="mb-3 text-xs text-slate-500">When this service opens.</p>
          <input
            type="time"
            value={data.start_time}
            onChange={(e) => onChange({ ...data, start_time: e.target.value })}
            className={SERVICE_FIELD_CLASS}
          />
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <label className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-slate-900">
            Service ends <HelpTooltip content={helpContent.services.endTime} />
          </label>
          <p className="mb-3 text-xs text-slate-500">When the dining period closes.</p>
          <input
            type="time"
            value={data.end_time}
            onChange={(e) => onChange({ ...data, end_time: e.target.value })}
            className={SERVICE_FIELD_CLASS}
          />
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <label className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-slate-900">
            Last online booking <HelpTooltip content={helpContent.services.lastBookingTime} />
          </label>
          <p className="mb-3 text-xs text-slate-500">Usually before closing.</p>
          <input
            type="time"
            value={data.last_booking_time}
            onChange={(e) => onChange({ ...data, last_booking_time: e.target.value })}
            className={SERVICE_FIELD_CLASS}
          />
        </div>
      </div>
    </div>
  );
}
