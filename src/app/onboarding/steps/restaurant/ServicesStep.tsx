'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { ServiceSettingsWorkspace } from '@/app/dashboard/availability/ServiceSettingsWorkspace';
import { useRestaurantOnboardingAvailability } from '@/hooks/use-restaurant-onboarding-availability';
import { ServiceAreaPicker } from './ServiceAreaPicker';

interface Props {
  onDone: () => Promise<void>;
}

export function ServicesStep({ onDone }: Props) {
  const { selectedAreaId, activeAreas, selectArea, services, setServices, loading } =
    useRestaurantOnboardingAvailability();
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <h2 className="mb-1 text-lg font-bold text-slate-900">Dining services & booking rules</h2>
      <p className="mb-3 text-sm text-slate-500">
        Configure named sittings (for example <em>Lunch</em> and <em>Dinner</em>), then set{' '}
        <strong className="font-medium text-slate-700">capacity</strong>,{' '}
        <strong className="font-medium text-slate-700">how long parties stay</strong>, and{' '}
        <strong className="font-medium text-slate-700">booking and deposit rules</strong> for each service in the
        editor below — the same layout as Availability → Services in your dashboard.
      </p>

      <div className="mb-6 rounded-xl border border-slate-200 bg-slate-50/80 p-4 text-sm text-slate-600">
        <p className="mb-2 font-medium text-slate-800">What you&apos;re setting here</p>
        <ul className="list-inside list-disc space-y-1">
          <li>
            <strong className="font-medium text-slate-700">Capacity</strong>: max covers and bookings per time slot,
            slot interval — think kitchen pace and host-stand flow.
          </li>
          <li>
            <strong className="font-medium text-slate-700">Duration</strong>: seated time by party size (longer tables
            usually stay longer).
          </li>
          <li>
            <strong className="font-medium text-slate-700">Booking rules</strong>: advance booking window, party-size
            limits online, deposits, cancellation notice.
          </li>
        </ul>
        <p className="mt-3 text-xs text-slate-500">
          New rows get sensible defaults — tune them below. Fine-tune anytime from{' '}
          <Link href="/dashboard/availability?tab=services" className="font-medium text-brand-600 underline hover:text-brand-700">
            Availability → Services
          </Link>
          .
        </p>
      </div>

      <ServiceAreaPicker
        activeAreas={activeAreas}
        selectedAreaId={selectedAreaId}
        onSelectArea={(id) => void selectArea(id)}
      />

      <ServiceSettingsWorkspace
        services={services}
        setServices={setServices}
        selectedAreaId={selectedAreaId}
        showToast={showToast}
      />

      <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          onClick={() => void onDone()}
          className="text-sm text-slate-500 hover:text-slate-700"
        >
          Skip for now
        </button>
        <button
          type="button"
          onClick={() => void onDone()}
          className="rounded-lg bg-brand-600 px-6 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          Continue
        </button>
      </div>

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
