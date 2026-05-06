'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { BookingModel } from '@/types/booking-models';
import { APPOINTMENTS_ACTIVE_MODEL_ORDER } from '@/lib/booking/active-models';
import { BOOKING_MODEL_SIGNUP_CARDS } from '@/lib/business-config';

const MODEL_CARD_COPY: Record<
  Extract<BookingModel, 'unified_scheduling' | 'class_session' | 'event_ticket' | 'resource_booking'>,
  { title: string; description: string }
> = {
  unified_scheduling: {
    title: 'Appointments',
    description: 'Clients book services with a calendar, person, or room.',
  },
  class_session: {
    title: 'Classes',
    description: 'Guests book spots in recurring or one-off scheduled sessions.',
  },
  event_ticket: {
    title: 'Events',
    description: 'Sell tickets for dated events and experiences.',
  },
  resource_booking: {
    title: 'Bookable resources',
    description: 'Let guests book rooms, courts, equipment, or other named resources.',
  },
};

const SELECTABLE_MODELS = APPOINTMENTS_ACTIVE_MODEL_ORDER;

export default function SignupBookingModelsPage() {
  const router = useRouter();
  const [selected, setSelected] = useState<BookingModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/venue/onboarding', { cache: 'no-store' });
        if (!res.ok) {
          if (res.status === 401) {
            router.replace('/login?redirectTo=/signup/booking-models');
            return;
          }
          if (res.status === 404) {
            router.replace('/signup/plan?plan=appointments');
            return;
          }
          throw new Error('Failed to load your account');
        }
        const data = (await res.json()) as {
          venue?: { pricing_tier?: string; active_booking_models?: BookingModel[]; onboarding_completed?: boolean };
        };
        const venue = data.venue;
        if (!venue) {
          throw new Error('Missing venue');
        }
        // Redirect non-appointments-SKU tiers (restaurant, founding, etc.) directly to onboarding.
        // 'appointments', 'light', and 'plus' all use the unified appointments wizard and must go
        // through this model-selection step before /onboarding can proceed (otherwise /onboarding
        // detects no active_booking_models and bounces them back here, creating an infinite loop).
        if (
          venue.pricing_tier !== 'appointments' &&
          venue.pricing_tier !== 'light' &&
          venue.pricing_tier !== 'plus'
        ) {
          router.replace('/onboarding');
          return;
        }
        const activeModels = Array.isArray(venue.active_booking_models) ? venue.active_booking_models : [];
        if (venue.onboarding_completed || activeModels.length > 0) {
          router.replace('/onboarding');
          return;
        }
        if (!cancelled) {
          setSelected(['unified_scheduling']);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load booking models.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const cards = useMemo(
    () =>
      BOOKING_MODEL_SIGNUP_CARDS.filter((card) =>
        SELECTABLE_MODELS.includes(card.model as (typeof SELECTABLE_MODELS)[number]),
      ),
    [],
  );

  function toggleModel(model: BookingModel) {
    setSelected((prev) => {
      if (prev.includes(model) && prev.length === 1) return prev;
      return prev.includes(model) ? prev.filter((item) => item !== model) : [...prev, model];
    });
  }

  async function handleContinue() {
    if (selected.length === 0) {
      setError('Choose at least one booking model to continue.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/venue/onboarding', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active_booking_models: selected }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? 'Failed to save booking models.');
      }
      router.push('/onboarding');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save booking models.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600" />
      </div>
    );
  }

  return (
    <div className="w-full max-w-3xl">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold text-slate-900">Choose your starting booking models</h1>
        <p className="mt-2 text-sm text-slate-500">
          Appointments, classes, events, and bookable resources are all included. Select what to configure first. You
          can change this later in Settings. Next, onboarding will walk through your profile, hours, calendars, and these
          choices.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {cards.map((card) => {
          const model = card.model as Extract<
            BookingModel,
            'unified_scheduling' | 'class_session' | 'event_ticket' | 'resource_booking'
          >;
          const checked = selected.includes(model);
          return (
            <button
              key={model}
              type="button"
              onClick={() => toggleModel(model)}
              className={`rounded-2xl border px-5 py-5 text-left transition-all ${
                checked
                  ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500'
                  : 'border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{MODEL_CARD_COPY[model].title}</p>
                  <p className="mt-1 text-sm text-slate-600">{MODEL_CARD_COPY[model].description}</p>
                  <p className="mt-2 text-xs text-slate-500">Examples: {card.examples}</p>
                </div>
                <span
                  className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                    checked ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white'
                  }`}
                  aria-hidden="true"
                >
                  {checked ? (
                    <svg
                      className="block h-3.5 w-3.5 shrink-0"
                      viewBox="0 0 24 24"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                      aria-hidden
                    >
                      <path
                        d="M4.5 12.75l6 6 9-13.5"
                        stroke="currentColor"
                        strokeWidth={2.75}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ) : null}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {error && (
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mt-8 flex items-center justify-between gap-4">
        <p className="text-sm text-slate-500">
          {selected.length} booking model{selected.length === 1 ? '' : 's'} selected
        </p>
        <button
          type="button"
          onClick={handleContinue}
          disabled={saving}
          className="rounded-xl bg-brand-600 px-8 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Continue to onboarding'}
        </button>
      </div>
    </div>
  );
}
