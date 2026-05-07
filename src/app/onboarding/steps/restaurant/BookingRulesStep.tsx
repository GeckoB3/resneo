'use client';

import { useCallback, useState } from 'react';
import { ServiceSettingsWorkspace } from '@/app/dashboard/availability/ServiceSettingsWorkspace';
import { useRestaurantOnboardingAvailability } from '@/hooks/use-restaurant-onboarding-availability';
import { ServiceAreaPicker } from './ServiceAreaPicker';

interface Props {
  onDone: () => Promise<void>;
}

export function BookingRulesStep({ onDone }: Props) {
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
      <h2 className="mb-1 text-lg font-bold text-slate-900">Booking rules & deposits</h2>
      <p className="mb-3 text-sm text-slate-500">
        Booking rules live inside each service setup. Use the editor below to adjust how far ahead guests can
        book, party sizes, large-party redirects, deposits, and cancellation windows.
      </p>

      <div className="mb-6 rounded-xl border border-slate-200 bg-slate-50/80 p-4 text-sm text-slate-600">
        <p className="mb-2 font-medium text-slate-800">What each field means</p>
        <ul className="list-inside list-disc space-y-1">
          <li><strong className="font-medium">Advance notice</strong>: the earliest a guest can book before arrival (e.g. 60 min).</li>
          <li><strong className="font-medium">Maximum advance</strong>: how many days ahead bookings are open (e.g. 60 days).</li>
          <li><strong className="font-medium">Party sizes online</strong>: smallest and largest party guests can book online without calling.</li>
          <li><strong className="font-medium">Large-party message</strong>: custom text shown to anyone over the online limit (typically &quot;Please call us&quot;).</li>
          <li><strong className="font-medium">Deposit threshold</strong>: party size at which a deposit becomes required.</li>
          <li><strong className="font-medium">Cancellation notice</strong>: hours before arrival that a guest must cancel to get a refund.</li>
        </ul>
        <p className="mt-2 text-xs text-slate-500">
          Deposits need Stripe. You&apos;ll connect Stripe later in this flow, then come back and enable deposits
          once it&apos;s connected.
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
