'use client';

import { useCallback, useEffect, useState } from 'react';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import type { ResolvedAppointmentsFeatureFlags, VenueFeatureFlags } from '@/lib/feature-flags';
import type { AnyAvailablePractitionerConfig } from '@/lib/feature-flags/any-available-practitioner-config';
import { DEFAULT_ANY_AVAILABLE_PRACTITIONER_CONFIG } from '@/lib/feature-flags/any-available-practitioner-config';
import { AnyAvailablePractitionerConfigSection } from '@/app/dashboard/settings/sections/AnyAvailablePractitionerConfigSection';

const FLAG_META: {
  key: keyof ResolvedAppointmentsFeatureFlags;
  title: string;
  description: string;
}[] = [
  {
    key: 'any_available_practitioner',
    title: 'Any available practitioner',
    description:
      'Guests and your team can book the next available slot without choosing a specific person. Available times are shared across everyone who offers that service.',
  },
  {
    key: 'guest_self_reschedule',
    title: 'Guest self-reschedule',
    description:
      'Guests can change their appointment date and time online from the link in their confirmation email. Deposit refunds if they cancel still follow your cancellation notice rules.',
  },
  {
    key: 'waitlist_v2',
    title: 'Appointment waitlist',
    description:
      'When you are fully booked, guests can join a waitlist. You can offer them a slot or send a notification, and cancelled slots can be offered to the waitlist automatically. For appointments only — not table reservations.',
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
  const [anyAvailableConfig, setAnyAvailableConfig] = useState<AnyAvailablePractitionerConfig>(
    initialRaw.any_available_practitioner_config ?? DEFAULT_ANY_AVAILABLE_PRACTITIONER_CONFIG,
  );
  const [calendars, setCalendars] = useState<Array<{ id: string; name: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!resolved.any_available_practitioner) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/venue/feature-flags');
        const data = (await res.json()) as {
          any_available_practitioner_config?: AnyAvailablePractitionerConfig;
          calendars?: Array<{ id: string; name: string }>;
        };
        if (cancelled || !res.ok) return;
        if (data.any_available_practitioner_config) {
          setAnyAvailableConfig(data.any_available_practitioner_config);
        }
        setCalendars(data.calendars ?? []);
      } catch {
        /* non-blocking */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [resolved.any_available_practitioner]);

  const persist = useCallback(
    async (
      nextRaw: VenueFeatureFlags,
      options?: { expectedOff?: keyof ResolvedAppointmentsFeatureFlags },
    ) => {
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
          any_available_practitioner_config?: AnyAvailablePractitionerConfig;
          calendars?: Array<{ id: string; name: string }>;
        };
        if (!res.ok) {
          throw new Error(typeof data.error === 'string' ? data.error : 'Save failed');
        }
        const savedRaw = data.raw ?? nextRaw;
        const savedResolved = data.resolved ?? resolved;
        setRaw(savedRaw);
        setResolved(savedResolved);
        if (data.any_available_practitioner_config) {
          setAnyAvailableConfig(data.any_available_practitioner_config);
        }
        if (data.calendars) setCalendars(data.calendars);
        onSaved(savedRaw, savedResolved);
        if (options?.expectedOff && savedResolved[options.expectedOff]) {
          setError(
            'This feature is turned on for your account by Reserve NI and cannot be switched off in settings. Contact support if you need it changed.',
          );
          return;
        }
        setMessage('Beta feature settings saved.');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Save failed');
      } finally {
        setSaving(false);
      }
    },
    [onSaved, resolved],
  );

  const saveAnyAvailableConfig = useCallback(
    async (config: AnyAvailablePractitionerConfig) => {
      const nextRaw: VenueFeatureFlags = {
        ...raw,
        any_available_practitioner: true,
        any_available_practitioner_config: config,
      };
      await persist(nextRaw);
      setAnyAvailableConfig(config);
    },
    [raw, persist],
  );

  const toggle = (key: keyof ResolvedAppointmentsFeatureFlags) => {
    const nextEnabled = !resolved[key];
    const nextRaw: VenueFeatureFlags = { ...raw };
    if (nextEnabled) {
      nextRaw[key] = true;
      void persist(nextRaw);
      return;
    }
    // Must send `false` — omitted keys are ignored by mergeVenueFeatureFlagsPatch.
    nextRaw[key] = false;
    if (key === 'any_available_practitioner') {
      delete nextRaw.any_available_practitioner_config;
    }
    void persist(nextRaw, { expectedOff: key });
  };

  return (
    <SectionCard elevated>
      <SectionCard.Header
        title="Beta features"
        description="Optional appointment tools for your venue. Each one stays off until you turn it on here."
      />
      <SectionCard.Body className="space-y-4">
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        {message ? <p className="text-sm text-emerald-700">{message}</p> : null}
        <ul className="space-y-3">
          {FLAG_META.map(({ key, title, description }) => (
            <li
              key={key}
              className="rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-3"
            >
              <div className="flex items-start justify-between gap-4">
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
              </div>
              {key === 'any_available_practitioner' ? (
                <AnyAvailablePractitionerConfigSection
                  enabled={resolved.any_available_practitioner}
                  initialConfig={anyAvailableConfig}
                  calendars={calendars}
                  saving={saving}
                  onSave={saveAnyAvailableConfig}
                />
              ) : null}
            </li>
          ))}
        </ul>
      </SectionCard.Body>
    </SectionCard>
  );
}
