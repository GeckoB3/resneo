'use client';

import type { StaffBookingSurfaceTab, StaffBookingSurfaceTabId } from '@/lib/booking/staff-booking-modal-options';

export function StaffBookingSurfaceTabsBar({
  tabs,
  activeId,
  onChange,
  ariaLabel = 'Booking type',
}: {
  tabs: StaffBookingSurfaceTab[];
  activeId: StaffBookingSurfaceTabId;
  onChange: (id: StaffBookingSurfaceTabId) => void;
  /** e.g. "Booking type — table, appointments…" vs appointment-only venues. */
  ariaLabel?: string;
}) {
  if (tabs.length === 0) return null;

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="mb-6 flex justify-center gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 shadow-sm"
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={activeId === tab.id}
          onClick={() => onChange(tab.id)}
          className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            activeId === tab.id
              ? 'bg-brand-600 text-white shadow-sm'
              : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
