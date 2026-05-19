'use client';

import { useCallback, useState } from 'react';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import type { ResolvedAppointmentsFeatureFlags, VenueFeatureFlags } from '@/lib/feature-flags';

const FLAG_META: {
  key: keyof ResolvedAppointmentsFeatureFlags;
  title: string;
  description: string;
}[] = [
  {
    key: 'any_available_practitioner',
    title: 'Any available practitioner',
    description:
      'Public and staff appointment booking can choose “any available” — pooled times across staff who offer the service.',
  },
  {
    key: 'guest_self_reschedule',
    title: 'Guest self-reschedule',
    description:
      'Guests can move appointments on the manage link within your cancellation notice window (no late fee until saved cards ship in Phase 1b).',
  },
  {
    key: 'waitlist_v2',
    title: 'Appointment waitlist',
    description:
      'Schedule waitlist for appointments: guest join, staff offer/notify, auto-offer on cancel (not the restaurant table waitlist).',
  },
];

export function FeatureFlagsSection({
  initialRaw,
  initialResolved,
  onSaved,
}: {
  initialRaw: VenueFeatureFlags;
  initialResolved: ResolvedAppointmentsFeatureFlags;
  onSaved: (raw: VenueFeatureFlags, resolved: ResolvedAppointmentsFeatureFlags) => void;
}) {
  const [raw, setRaw] = useState(initialRaw);
  const [resolved, setResolved] = useState(initialResolved);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const persist = useCallback(
    async (nextRaw: VenueFeatureFlags) => {
      setSaving(true);
      setError(null);
      setMessage(null);
      try {
        const res = await fetch('/api/venue/feature-flags', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(nextRaw),
        });
        const data = (await res.json()) as {
          error?: string;
          raw?: VenueFeatureFlags;
          resolved?: ResolvedAppointmentsFeatureFlags;
        };
        if (!res.ok) {
          throw new Error(typeof data.error === 'string' ? data.error : 'Save failed');
        }
        const savedRaw = data.raw ?? nextRaw;
        const savedResolved = data.resolved ?? resolved;
        setRaw(savedRaw);
        setResolved(savedResolved);
        onSaved(savedRaw, savedResolved);
        setMessage('Beta feature settings saved.');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Save failed');
      } finally {
        setSaving(false);
      }
    },
    [onSaved, resolved],
  );

  const toggle = (key: keyof ResolvedAppointmentsFeatureFlags) => {
    const nextEnabled = !resolved[key];
    const nextRaw: VenueFeatureFlags = { ...raw };
    if (nextEnabled) {
      nextRaw[key] = true;
    } else {
      delete nextRaw[key];
    }
    void persist(nextRaw);
  };

  return (
    <SectionCard elevated>
      <SectionCard.Header
        title="Beta features"
        description="Roll out Phase 1a appointment features per venue. Defaults are off until you enable them. Environment variables can override these toggles globally."
      />
      <SectionCard.Body className="space-y-4">
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        {message ? <p className="text-sm text-emerald-700">{message}</p> : null}
        <ul className="space-y-3">
          {FLAG_META.map(({ key, title, description }) => (
            <li
              key={key}
              className="flex items-start justify-between gap-4 rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">{title}</p>
                <p className="mt-0.5 text-xs text-slate-600">{description}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={resolved[key]}
                disabled={saving}
                onClick={() => toggle(key)}
                className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:opacity-50 ${
                  resolved[key] ? 'bg-brand-600' : 'bg-slate-300'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 translate-y-0.5 rounded-full bg-white shadow transition-transform ${
                    resolved[key] ? 'translate-x-5' : 'translate-x-0.5'
                  }`}
                />
                <span className="sr-only">{resolved[key] ? 'On' : 'Off'}</span>
              </button>
            </li>
          ))}
        </ul>
      </SectionCard.Body>
    </SectionCard>
  );
}
