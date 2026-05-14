'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { SetupStatus } from '@/lib/venue/compute-setup-status';
import { Pill } from '@/components/ui/dashboard/Pill';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import type { BookingModel } from '@/types/booking-models';
import { isUnifiedSchedulingVenue } from '@/lib/booking/unified-scheduling';

type SetupStepKey = keyof Omit<
  SetupStatus,
  | 'is_admin'
  | 'booking_model'
  | 'active_booking_models'
  | 'enabled_models'
  | 'onboarding_completed'
  | 'pricing_tier'
  | 'setup_checklist_dismissed'
>;

interface Step {
  key: SetupStepKey;
  label: string;
  description: string;
  href: string;
  actionLabel: string;
}

function getAvailabilityStep(model: BookingModel, onboardingCompleted: boolean): Step {
  switch (model) {
    case 'practitioner_appointment':
    case 'unified_scheduling':
      return {
        key: 'availability_set',
        label: onboardingCompleted ? 'Services & calendars' : 'Team & services',
        description: onboardingCompleted
          ? 'Adjust which services are offered on each calendar, or add more services.'
          : 'Add team calendars, link services, and set when guests can book.',
        href: '/dashboard/appointment-services',
        actionLabel: 'Appointment services',
      };
    case 'event_ticket':
      return {
        key: 'availability_set',
        label: 'Events',
        description: 'Review your events and ticket types, or create new ones.',
        href: '/dashboard/event-manager',
        actionLabel: 'View events',
      };
    case 'class_session':
      return {
        key: 'availability_set',
        label: 'Classes & timetable',
        description: 'Review your class schedule, or add new classes.',
        href: '/dashboard/class-timetable',
        actionLabel: 'View timetable',
      };
    case 'resource_booking':
      return {
        key: 'availability_set',
        label: 'Resources',
        description: 'Review your bookable resources, or add new ones.',
        href: '/dashboard/resource-timeline',
        actionLabel: 'View resources',
      };
    default:
      return {
        key: 'availability_set',
        label: 'Services & availability',
        description: 'Run the setup wizard to configure your service periods, capacity, and booking rules.',
        href: '/dashboard/onboarding',
        actionLabel: 'Run setup wizard',
      };
  }
}

function isSetupComplete(s: SetupStatus) {
  return (
    s.profile_complete &&
    s.availability_set &&
    s.guest_booking_ready &&
    s.stripe_connected &&
    s.first_booking_made &&
    s.secondary_event_catalog_ready &&
    s.secondary_class_catalog_ready &&
    s.secondary_resource_catalog_ready
  );
}

function getGuestBookingStep(model: BookingModel, onboardingCompleted: boolean): Step {
  switch (model) {
    case 'practitioner_appointment':
    case 'unified_scheduling':
      return {
        key: 'guest_booking_ready',
        label: 'Public booking page',
        description: onboardingCompleted
          ? 'Your booking page needs at least one active service linked to a calendar. Check assignments under Appointment Services.'
          : 'Guests need at least one calendar with an active service linked before they can book online.',
        href: '/dashboard/appointment-services',
        actionLabel: 'Review services',
      };
    default:
      return {
        key: 'guest_booking_ready',
        label: 'Public booking page',
        description:
          'Add at least one active service and complete availability so online guests can see times and book.',
        href: '/dashboard/onboarding',
        actionLabel: 'Finish setup',
      };
  }
}

function getSecondaryCatalogSteps(enabledModels: BookingModel[], onboardingCompleted: boolean): Step[] {
  const steps: Step[] = [];
  if (enabledModels.includes('event_ticket')) {
    steps.push({
      key: 'secondary_event_catalog_ready',
      label: 'Events',
      description: onboardingCompleted
        ? 'Optional: add another ticketed event or edit existing ones in Event manager.'
        : 'Add a ticketed event so guests can book from your Events tab.',
      href: '/dashboard/event-manager',
      actionLabel: 'Event manager',
    });
  }
  if (enabledModels.includes('class_session')) {
    steps.push({
      key: 'secondary_class_catalog_ready',
      label: 'Classes',
      description: onboardingCompleted
        ? 'Optional: add a timetable rule or more class types under Class timetable.'
        : 'Add a class type and schedule so guests can book classes.',
      href: '/dashboard/class-timetable',
      actionLabel: 'Class timetable',
    });
  }
  if (enabledModels.includes('resource_booking')) {
    steps.push({
      key: 'secondary_resource_catalog_ready',
      label: 'Resources',
      description: onboardingCompleted
        ? 'Optional: add another bookable resource or edit slots under Resource timeline.'
        : 'Add a bookable resource so guests can book it from the Resources tab.',
      href: '/dashboard/resource-timeline',
      actionLabel: 'Resource timeline',
    });
  }
  return steps;
}

function setupChecklistDismissStorageKey(venueId: string): string {
  return `reserve_ni_setup_checklist_dismissed_${venueId}`;
}

function readDismissedFromStorage(venueId: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(setupChecklistDismissStorageKey(venueId)) === '1';
  } catch {
    return false;
  }
}

function writeDismissedToStorage(venueId: string): void {
  try {
    localStorage.setItem(setupChecklistDismissStorageKey(venueId), '1');
  } catch {
    /* private mode or quota */
  }
}

async function persistDismissToServer(): Promise<boolean> {
  try {
    const res = await fetch('/api/venue/setup-checklist-dismiss', { method: 'POST' });
    return res.ok;
  } catch (e) {
    console.error('[SetupChecklist] persist dismiss to server failed:', e);
    return false;
  }
}

function getSteps(status: SetupStatus): Step[] {
  const model = status.booking_model;
  const enabledModels = status.enabled_models;
  const onboardingDone = status.onboarding_completed;

  const base: Step[] = [
    {
      key: 'profile_complete',
      label: 'Business profile',
      description: onboardingDone
        ? 'Review logo, contact details, and venue settings.'
        : 'Add your business name, address, phone number, and cover photo.',
      href: '/dashboard/settings',
      actionLabel: onboardingDone ? 'Venue settings' : 'Complete profile',
    },
    getAvailabilityStep(model, onboardingDone),
  ];
  if (model === 'table_reservation' || isUnifiedSchedulingVenue(model)) {
    base.push(getGuestBookingStep(model, onboardingDone));
  }
  base.push(...getSecondaryCatalogSteps(enabledModels, onboardingDone));
  base.push(
    {
      key: 'stripe_connected',
      label: 'Stripe payments',
      description:
        'Connect Stripe so you can take deposits and card payments (Connect pays out to your bank).',
      href: '/dashboard/settings?tab=payments',
      actionLabel: 'Connect Stripe',
    },
    {
      key: 'first_booking_made',
      label: 'First test booking',
      description: 'Try the guest flow once to confirm booking and emails look right.',
      href: '/dashboard/bookings/new',
      actionLabel: 'Create booking',
    },
  );
  return base;
}

export function SetupChecklist({
  venueId,
  setupStatusFromServer,
  disableClientSetupFetch = false,
}: {
  venueId: string;
  /** When provided with `disableClientSetupFetch`, skip the client fetch (dashboard home server path). */
  setupStatusFromServer?: SetupStatus | null;
  disableClientSetupFetch?: boolean;
}) {
  const [status, setStatus] = useState<SetupStatus | null>(() =>
    disableClientSetupFetch ? setupStatusFromServer ?? null : null,
  );
  const [dismissed, setDismissed] = useState(() =>
    Boolean(setupStatusFromServer?.setup_checklist_dismissed),
  );

  useEffect(() => {
    if (disableClientSetupFetch) {
      queueMicrotask(() => {
        const data = setupStatusFromServer;
        if (!data) {
          setDismissed(true);
          return;
        }
        const legacyLocal = readDismissedFromStorage(venueId);
        if (legacyLocal && !data.setup_checklist_dismissed) {
          void persistDismissToServer();
        }
        if (data.setup_checklist_dismissed || legacyLocal) {
          setDismissed(true);
          return;
        }
        setStatus(data);
        if (isSetupComplete(data)) {
          writeDismissedToStorage(venueId);
          void persistDismissToServer();
          setDismissed(true);
        }
      });
      return;
    }

    const id = requestAnimationFrame(() => {
      fetch('/api/venue/setup-status')
        .then((r) => (r.ok ? r.json() : null))
        .then((data: SetupStatus | null) => {
          if (!data) return;
          if (!data.is_admin) {
            setDismissed(true);
            return;
          }
          const legacyLocal = readDismissedFromStorage(venueId);
          if (legacyLocal && !data.setup_checklist_dismissed) {
            void persistDismissToServer();
          }
          if (data.setup_checklist_dismissed || legacyLocal) {
            setDismissed(true);
            return;
          }
          setStatus(data);
          if (isSetupComplete(data)) {
            writeDismissedToStorage(venueId);
            void persistDismissToServer();
            setDismissed(true);
          }
        })
        .catch((e) => console.error('[SetupChecklist] status load failed:', e));
    });
    return () => cancelAnimationFrame(id);
  }, [disableClientSetupFetch, setupStatusFromServer, venueId]);

  const steps = useMemo(() => (status ? getSteps(status) : []), [status]);

  const incompleteSteps = useMemo(() => steps.filter((s) => !status?.[s.key]), [steps, status]);

  function dismiss() {
    writeDismissedToStorage(venueId);
    setDismissed(true);
    void persistDismissToServer().then((ok) => {
      if (!ok) {
        console.error('[SetupChecklist] Dismiss saved locally only; server persist failed.', { venueId });
      }
    });
  }

  if (dismissed || !status) return null;

  const completedCount = steps.filter((s) => status[s.key]).length;
  const totalCount = steps.length;
  if (completedCount === totalCount) return null;

  const progressPct = Math.round((completedCount / totalCount) * 100);

  return (
    <div className="mb-6">
      <SectionCard className="border-brand-200/70">
        <SectionCard.Header
          eyebrow="Setup"
          title={
            status.onboarding_completed
              ? `What's next (${completedCount}/${totalCount})`
              : `Get your venue ready (${completedCount}/${totalCount})`
          }
          description={
            status.onboarding_completed
              ? 'Showing only what still needs attention (steps you finished in onboarding are not listed again).'
              : 'Outstanding tasks to get your venue live for guests.'
          }
          right={
            <div className="flex items-center gap-2">
              <Pill variant="brand" size="sm">
                {progressPct}%
              </Pill>
              <button
                type="button"
                onClick={dismiss}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Dismiss setup checklist"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          }
        />
        <SectionCard.Body className="!pt-0">
          <div className="mb-4 h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-700 transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100 bg-slate-50/40">
            {incompleteSteps.map((step) => (
              <li key={step.key} className="flex items-center gap-4 px-4 py-3.5 sm:px-5">
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border-2 border-dashed border-slate-200 bg-white">
                  <div className="h-2 w-2 rounded-full bg-slate-300" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900">{step.label}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-slate-600">{step.description}</p>
                </div>
                <Link
                  href={step.href}
                  className="flex-shrink-0 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-xs font-semibold text-brand-800 shadow-sm transition-colors hover:bg-brand-100"
                >
                  {step.actionLabel}
                </Link>
              </li>
            ))}
          </ul>
        </SectionCard.Body>
      </SectionCard>
    </div>
  );
}
