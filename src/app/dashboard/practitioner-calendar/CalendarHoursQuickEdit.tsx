'use client';

import { useEffect, useState } from 'react';
import { Dialog } from '@/components/ui/primitives/Dialog';
import { AppointmentAvailabilitySettings } from '@/app/dashboard/availability/AppointmentAvailabilitySettings';
import { OpeningHoursSection } from '@/app/dashboard/settings/sections/OpeningHoursSection';
import { BusinessClosuresSection } from '@/app/dashboard/settings/sections/BusinessClosuresSection';
import type { VenueSettings } from '@/app/dashboard/settings/types';
import { readResponseJson } from '@/lib/http/read-response-json';

/**
 * The diary's clock button.
 *
 * Admins choose between amending calendar hours and amending business hours;
 * staff go straight to calendar hours, where the availability screen already
 * limits them to the calendars they are allocated. Both editors are the real
 * settings components, so nothing here saves anything itself. The parent
 * refreshes the diary when the dialog closes.
 *
 * Mount only while open: every piece of state below resets on the next open.
 */
export function CalendarHoursQuickEdit({
  isAdmin,
  currentStaffId,
  date,
  bookingModel,
  onClose,
}: {
  isAdmin: boolean;
  currentStaffId: string | null;
  /** yyyy-mm-dd the diary is showing; the closures tabs open with it picked. */
  date: string;
  bookingModel: string;
  onClose: () => void;
}) {
  const [screen, setScreen] = useState<'choose' | 'calendar' | 'business'>(isAdmin ? 'choose' : 'calendar');

  if (screen === 'choose') {
    return (
      <Dialog
        open
        onOpenChange={(next) => {
          if (!next) onClose();
        }}
        title="Amend hours"
        description="Change when a calendar works, or when the business is open."
        size="sm"
      >
        <div className="grid gap-3">
          <button
            type="button"
            onClick={() => setScreen('calendar')}
            className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-left transition hover:border-brand-300 hover:bg-brand-50/40"
          >
            <span className="block text-sm font-semibold text-slate-900">Amend calendar hours</span>
            <span className="mt-0.5 block text-xs text-slate-500">
              Weekly availability, breaks, and closures or amended hours for one calendar.
            </span>
          </button>
          <button
            type="button"
            onClick={() => setScreen('business')}
            className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-left transition hover:border-brand-300 hover:bg-brand-50/40"
          >
            <span className="block text-sm font-semibold text-slate-900">Amend business hours</span>
            <span className="mt-0.5 block text-xs text-slate-500">
              Weekly opening hours, and closures or amended hours for the whole venue.
            </span>
          </button>
        </div>
      </Dialog>
    );
  }

  if (screen === 'calendar') {
    return (
      <Dialog
        open
        onOpenChange={(next) => {
          if (!next) onClose();
        }}
        title="Amend calendar hours"
        size="lg"
        contentClassName="max-w-4xl"
      >
        <AppointmentAvailabilitySettings
          isAdmin={isAdmin}
          currentStaffId={currentStaffId}
          embedded={{ initialTab: 'daysoff', initialDate: date }}
        />
      </Dialog>
    );
  }

  return <BusinessHoursDialog date={date} bookingModel={bookingModel} onClose={onClose} />;
}

type BusinessTab = 'weekly' | 'closures';

function BusinessHoursDialog({
  date,
  bookingModel,
  onClose,
}: {
  date: string;
  bookingModel: string;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<BusinessTab>('closures');
  const [venue, setVenue] = useState<VenueSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/venue', { cache: 'no-store' });
        const body = await readResponseJson<{ venue?: VenueSettings; error?: string } & Partial<VenueSettings>>(res);
        if (!res.ok) throw new Error(body.error ?? 'Failed to load venue');
        const row = (body.venue ?? body) as VenueSettings;
        if (!cancelled) setVenue(row);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load venue');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const tabs: Array<{ key: BusinessTab; label: string }> = [
    { key: 'weekly', label: 'Weekly opening hours' },
    { key: 'closures', label: 'Closures & amended hours' },
  ];

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Amend business hours"
      size="lg"
      contentClassName="max-w-4xl"
    >
      <div className="mb-4 flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1 sm:flex-nowrap">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`flex-1 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              tab === t.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {!venue && !error ? <p className="text-sm text-slate-500">Loading…</p> : null}
      {venue && tab === 'weekly' ? (
        <OpeningHoursSection
          venue={venue}
          onUpdate={(patch) => setVenue((v) => (v ? { ...v, ...patch } : v))}
          isAdmin
          bookingModel={bookingModel}
          hideClosures
        />
      ) : null}
      {venue && tab === 'closures' ? (
        <BusinessClosuresSection
          bookingModel={bookingModel}
          venue={venue}
          isAdmin
          onUpdate={(patch) => setVenue((v) => (v ? { ...v, ...patch } : v))}
          initialDate={date}
        />
      ) : null}
    </Dialog>
  );
}
