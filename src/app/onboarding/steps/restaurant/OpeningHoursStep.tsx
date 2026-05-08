'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { OpeningHoursSettings } from '@/app/dashboard/settings/types';
import { OpeningHoursControl, defaultOpeningHoursSettings } from '@/components/scheduling/OpeningHoursControl';

/** Starter hours when venue has none saved yet: Mon–Sat 12:00–22:00, Sunday closed. */
function restaurantFallbackHours(): OpeningHoursSettings {
  return {
    ...defaultOpeningHoursSettings(),
    '0': { closed: true },
    '1': { periods: [{ open: '12:00', close: '22:00' }] },
    '2': { periods: [{ open: '12:00', close: '22:00' }] },
    '3': { periods: [{ open: '12:00', close: '22:00' }] },
    '4': { periods: [{ open: '12:00', close: '22:00' }] },
    '5': { periods: [{ open: '12:00', close: '22:00' }] },
    '6': { periods: [{ open: '12:00', close: '22:00' }] },
  };
}

interface Props {
  onDone: () => Promise<void>;
}

export function OpeningHoursStep({ onDone }: Props) {
  const [hours, setHours] = useState<OpeningHoursSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/venue');
        if (!res.ok) {
          if (!cancelled) setLoadError('Could not load existing hours.');
          return;
        }
        const data = (await res.json()) as { opening_hours?: OpeningHoursSettings | null };
        const raw = data.opening_hours;
        if (cancelled) return;
        if (raw && typeof raw === 'object' && Object.keys(raw).length > 0) {
          setHours(raw as OpeningHoursSettings);
        } else {
          setHours(restaurantFallbackHours());
        }
      } catch {
        if (!cancelled) {
          setLoadError('Could not load existing hours.');
          setHours(restaurantFallbackHours());
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSave() {
    if (!hours) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/venue/opening-hours', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(hours),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? 'Failed to save opening hours');
      }
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save. Please try again.');
      setSaving(false);
    }
  }

  if (!hours) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div>
      <h2 className="mb-1 text-lg font-bold text-slate-900">When are you open?</h2>
      <p className="mb-4 text-sm text-slate-500">
        Set the outer window for online bookings: the broadest hours guests could ever book. In the next
        steps you&apos;ll define named sittings (e.g. Lunch, Dinner) inside this window.
      </p>
      {loadError && (
        <p className="mb-3 text-xs text-amber-800">{loadError} Showing starter hours; you can edit before saving.</p>
      )}

      <div className="mb-6 rounded-xl border border-slate-200 bg-slate-50/80 p-4 text-sm text-slate-600">
        <p className="mb-2 font-medium text-slate-800">How this fits together</p>
        <ul className="list-inside list-disc space-y-1">
          <li>Opening hours are the maximum window: guests can never book outside them.</li>
          <li>Dining services (next step) narrow it to named sittings like Lunch and Dinner.</li>
          <li>You can set one-off closures and amended hours any time from{' '}
            <Link
              href="/dashboard/settings?tab=business-hours"
              className="font-medium text-brand-600 underline hover:text-brand-700"
            >
              Settings → Business Hours
            </Link>
            .
          </li>
        </ul>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <OpeningHoursControl value={hours} onChange={setHours} disabled={saving} />

      <div className="mt-8 flex items-center justify-between">
        <button
          type="button"
          onClick={() => void onDone()}
          disabled={saving}
          className="text-sm text-slate-500 hover:text-slate-700"
        >
          Skip for now
        </button>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="rounded-lg bg-brand-600 px-6 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save & continue'}
        </button>
      </div>
    </div>
  );
}
