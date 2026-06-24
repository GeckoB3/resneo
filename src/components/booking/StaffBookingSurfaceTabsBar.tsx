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
    <div className="mb-6 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
      {/*
       * Center the tabs when they fit, but scroll from the first tab when they don't. The inner
       * `mx-auto w-max` centers the row while there is free space, then pins it to the start once
       * the tabs overflow — so no tab is clipped on narrow screens (the old `justify-center` +
       * `overflow-x-auto` cut off the edge tabs when all booking surfaces were enabled). Tabs also
       * shrink a touch on mobile, then grow from `sm`.
       */}
      <div role="tablist" aria-label={ariaLabel} className="mx-auto flex w-max gap-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeId === tab.id}
            onClick={() => onChange(tab.id)}
            className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-medium transition-colors sm:px-4 sm:text-sm ${
              activeId === tab.id
                ? 'bg-brand-600 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}
