'use client';

import type { ReactNode } from 'react';
import { CalendarLimitMessage } from '@/components/dashboard/CalendarLimitMessage';
import type { CalendarEntitlement } from '@/hooks/use-calendar-entitlement';

export type OnboardingInlineAddCalendarLayout = 'event' | 'panel';

/**
 * Inline “Add calendar” during onboarding: always shows the control; at plan limit the button is disabled and
 * {@link CalendarLimitMessage} appears directly beneath it.
 */
export function OnboardingInlineAddCalendarControls({
  entitlementLoaded,
  canAddCalendar,
  entitlement,
  onAddCalendar,
  layout,
  helperWhenCanAdd,
}: {
  entitlementLoaded: boolean;
  canAddCalendar: boolean;
  entitlement: CalendarEntitlement | null;
  onAddCalendar: () => void;
  layout: OnboardingInlineAddCalendarLayout;
  /** Shown directly under the button while the venue can still add calendars. */
  helperWhenCanAdd: ReactNode;
}) {
  if (!entitlementLoaded) {
    return <p className="text-xs text-slate-500">Loading plan limits…</p>;
  }

  const limitNotice = (
    <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50/90 px-3 py-2 text-xs text-amber-950">
      <CalendarLimitMessage
        entitlement={entitlement}
        linkClassName="font-medium text-brand-700 underline hover:text-brand-800"
      />
    </div>
  );

  if (layout === 'event') {
    return (
      <>
        <button
          type="button"
          disabled={!canAddCalendar}
          onClick={() => {
            if (canAddCalendar) onAddCalendar();
          }}
          className={`text-sm font-semibold text-brand-600 hover:text-brand-800 ${
            !canAddCalendar ? 'cursor-not-allowed opacity-50 hover:text-brand-600' : ''
          }`}
        >
          + Add calendar
        </button>
        {canAddCalendar ? <div className="mt-1 text-xs text-slate-500">{helperWhenCanAdd}</div> : limitNotice}
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        disabled={!canAddCalendar}
        onClick={() => {
          if (canAddCalendar) onAddCalendar();
        }}
        className={`inline-flex w-full items-center justify-center rounded-lg border border-brand-200/90 bg-white px-3.5 py-2.5 text-sm font-semibold text-brand-700 shadow-sm transition-colors hover:border-brand-400 hover:bg-brand-50 hover:text-brand-800 ${
          !canAddCalendar ? 'cursor-not-allowed opacity-50 hover:border-brand-200/90 hover:bg-white' : ''
        }`}
      >
        Add calendar
      </button>
      {canAddCalendar ? <div className="mt-2 text-xs text-slate-500">{helperWhenCanAdd}</div> : limitNotice}
    </>
  );
}
