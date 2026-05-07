'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { ServiceSettingsWorkspace } from '@/app/dashboard/availability/ServiceSettingsWorkspace';
import { useRestaurantOnboardingAvailability } from '@/hooks/use-restaurant-onboarding-availability';
import { ServiceAreaPicker } from './ServiceAreaPicker';

interface Props {
  onDone: () => Promise<void>;
}

export function DiningDurationStep({ onDone }: Props) {
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
      <h2 className="mb-1 text-lg font-bold text-slate-900">How long does each party stay?</h2>
      <p className="mb-3 text-sm text-slate-500">
        Dining durations are managed inside each service. Larger parties usually stay longer, and dinner
        typically runs longer than lunch. These numbers affect when the next guest can be offered the same table.
      </p>

      <div className="mb-6 rounded-xl border border-slate-200 bg-slate-50/80 p-4 text-sm text-slate-600">
        <p className="mb-2 font-medium text-slate-800">A good starting point</p>
        <ul className="list-inside list-disc space-y-1">
          <li>Lunch: 1–2 guests 75 min · 3–4 guests 90 min · 5+ guests 120 min.</li>
          <li>Dinner: 1–2 guests 90 min · 3–4 guests 120 min · 5+ guests 150 min.</li>
          <li>Fine dining: add 15–30 minutes to each band.</li>
        </ul>
        <p className="mt-2 text-xs text-slate-500">
          Tip: you can add day-of-week overrides (e.g. give Sunday 30 extra minutes) later from{' '}
          <Link href="/dashboard/availability?tab=services" className="font-medium text-brand-600 underline">
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
        <button type="button" onClick={() => void onDone()} className="text-sm text-slate-500 hover:text-slate-700">
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
