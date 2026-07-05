'use client';

import { useCallback, useEffect, useState } from 'react';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import type { ResolvedAppointmentsFeatureFlags, VenueFeatureFlags } from '@/lib/feature-flags';
import type { AnyAvailablePractitionerConfig } from '@/lib/feature-flags/any-available-practitioner-config';
import { DEFAULT_ANY_AVAILABLE_PRACTITIONER_CONFIG } from '@/lib/feature-flags/any-available-practitioner-config';
import { AnyAvailablePractitionerConfigSection } from '@/app/dashboard/settings/sections/AnyAvailablePractitionerConfigSection';
import {
  WaitlistConfigSection,
  waitlistModeFromFlags,
} from '@/app/dashboard/settings/sections/WaitlistConfigSection';
import { useDashboardWaitlistNavSync } from '@/app/dashboard/DashboardShell';
import type { AppointmentWaitlistMode } from '@/lib/booking/waitlist-config';

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
      'When you are fully booked, guests can join a waitlist for their preferred date, time, calendar, and service. Choose how your team is notified when a slot opens.',
  },
  {
    key: 'class_commerce_enabled',
    title: 'Class packs, courses & memberships',
    description:
      'Turn on prepaid class commerce: credit packs, fixed-session courses, and recurring membership plans. Adds a "Class products" area to your Classes dashboard and exposes them in guest accounts.',
  },
  {
    key: 'card_hold_deposits',
    title: 'Card hold deposits',
    description:
      'Card on file with a chargeable no-show fee. No payment taken at booking.',
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
  const [waitlistMode, setWaitlistMode] = useState<AppointmentWaitlistMode>(() =>
    waitlistModeFromFlags(initialRaw),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const waitlistNavSync = useDashboardWaitlistNavSync();

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
      options?: {
        expectedOff?: keyof ResolvedAppointmentsFeatureFlags;
        waitlistJustEnabled?: boolean;
      },
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
        setWaitlistMode(waitlistModeFromFlags(savedRaw));
        if (data.any_available_practitioner_config) {
          setAnyAvailableConfig(data.any_available_practitioner_config);
        }
        if (data.calendars) setCalendars(data.calendars);
        waitlistNavSync?.setAppointmentWaitlistEnabled(savedResolved.waitlist_v2);
        onSaved(savedRaw, savedResolved);
        if (options?.expectedOff && savedResolved[options.expectedOff]) {
          setError(
            'This feature is turned on for your account by Reserve NI and cannot be switched off in settings. Contact support if you need it changed.',
          );
          return;
        }
        if (options?.waitlistJustEnabled) {
          setMessage(
            'Appointment waitlist is on. Guests are notified by email when a slot opens — adjust SMS and templates under Settings → Communications → Waitlist invites.',
          );
        } else {
          setMessage('Setting saved.');
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Save failed');
      } finally {
        setSaving(false);
      }
    },
    [onSaved, resolved, waitlistNavSync],
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

  const saveWaitlistMode = useCallback(
    async (mode: AppointmentWaitlistMode) => {
      const nextRaw: VenueFeatureFlags = {
        ...raw,
        waitlist_v2: true,
        waitlist_config: { mode },
      };
      setWaitlistMode(mode);
      await persist(nextRaw);
    },
    [raw, persist],
  );

  const toggle = (key: keyof ResolvedAppointmentsFeatureFlags) => {
    const nextEnabled = !resolved[key];
    const nextRaw: VenueFeatureFlags = { ...raw };
    if (nextEnabled) {
      nextRaw[key] = true;
      if (key === 'waitlist_v2' && !nextRaw.waitlist_config) {
        nextRaw.waitlist_config = { mode: waitlistMode };
      }
      void persist(nextRaw, {
        waitlistJustEnabled: key === 'waitlist_v2' && !resolved.waitlist_v2,
      });
      return;
    }
    // Must send `false` — omitted keys are ignored by mergeVenueFeatureFlagsPatch.
    nextRaw[key] = false;
    if (key === 'any_available_practitioner') {
      delete nextRaw.any_available_practitioner_config;
    }
    if (key === 'waitlist_v2') {
      delete nextRaw.waitlist_config;
    }
    void persist(nextRaw, { expectedOff: key });
  };

  return (
    <SectionCard elevated>
      <SectionCard.Header
        title="Optional Booking features"
        description="Optional tools for your booking flow."
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
              {key === 'waitlist_v2' ? (
                <WaitlistConfigSection
                  enabled={resolved.waitlist_v2}
                  mode={waitlistMode}
                  saving={saving}
                  onModeChange={saveWaitlistMode}
                />
              ) : null}
            </li>
          ))}
        </ul>
      </SectionCard.Body>
    </SectionCard>
  );
}
