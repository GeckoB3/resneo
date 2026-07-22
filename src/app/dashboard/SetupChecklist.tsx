'use client';

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import type { SetupStatus } from '@/lib/venue/compute-setup-status';
import { Pill } from '@/components/ui/dashboard/Pill';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import { Dialog } from '@/components/ui/primitives/Dialog';
import { Button } from '@/components/ui/primitives/Button';
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
  /**
   * Unique id + React key. For required steps this matches a `SetupStatus` field
   * name and completion is read from that flag. The post-onboarding prompts use
   * ids that are not status fields; they complete once the user clicks through to
   * the linked page (`completeOnClick`), tracked per browser in localStorage.
   */
  key: string;
  label: string;
  description: string;
  href: string;
  actionLabel: string;
  /** Marks the step complete once its action button is clicked (see clicked-steps storage). */
  completeOnClick?: boolean;
}

/** Extra prompts shown alongside the required steps once onboarding is complete. */
const POST_ONBOARDING_SETUP_STEPS: Step[] = [
  {
    key: 'customise_booking_page',
    label: 'Customise your booking page',
    description:
      'Add your branding, cover photo, and welcome text so your booking page reflects your business.',
    href: '/dashboard/settings?tab=booking-page',
    actionLabel: 'Booking page',
    completeOnClick: true,
  },
  {
    key: 'review_comms',
    label: 'Review communications settings',
    description:
      'Check the emails and texts guests receive when they book, and tailor the wording to your business.',
    href: '/dashboard/settings?tab=comms',
    actionLabel: 'Communications',
    completeOnClick: true,
  },
  {
    key: 'import_bookings_customers',
    label: 'Import your bookings and customers',
    description:
      'Bring your existing bookings and customer list into ResNeo so nothing is left behind.',
    href: '/dashboard/settings',
    actionLabel: 'Import data',
    completeOnClick: true,
  },
];

/**
 * A required step is complete when its key maps to a truthy `SetupStatus` flag. A
 * `completeOnClick` prompt is complete once the user has clicked through to it
 * (its key is in `clickedStepKeys`).
 */
export function isStepComplete(
  status: SetupStatus,
  step: Step,
  clickedStepKeys?: ReadonlySet<string>,
): boolean {
  if (step.completeOnClick) return Boolean(clickedStepKeys?.has(step.key));
  return Boolean(status[step.key as SetupStepKey]);
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

function getGuestBookingStep(model: BookingModel): Step {
  switch (model) {
    case 'practitioner_appointment':
    case 'unified_scheduling':
      return {
        key: 'guest_booking_ready',
        label: 'Create services',
        description: 'Create at least one service to offer on your public booking page.',
        href: '/dashboard/appointment-services',
        actionLabel: 'Add services',
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

/**
 * Per-browser record of which `completeOnClick` prompts the user has clicked
 * through. Stored as a JSON array of step keys. Client-only, like the dismiss
 * fallback above; a soft nudge, so localStorage is sufficient.
 */
function clickedStepsStorageKey(venueId: string): string {
  return `reserve_ni_setup_checklist_clicked_${venueId}`;
}

function readClickedStepsFromStorage(venueId: string): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(clickedStepsStorageKey(venueId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function writeClickedStepToStorage(venueId: string, stepKey: string): void {
  try {
    const next = new Set(readClickedStepsFromStorage(venueId));
    next.add(stepKey);
    localStorage.setItem(clickedStepsStorageKey(venueId), JSON.stringify([...next]));
  } catch {
    /* private mode or quota */
  }
}

// Read the clicked-steps localStorage value through `useSyncExternalStore`, which
// reads client-only storage without a setState-in-effect (and without a hydration
// mismatch). Snapshots are cached per storage key + raw value so `getSnapshot`
// returns a stable reference until the underlying string actually changes.
const EMPTY_CLICKED_STEPS: ReadonlySet<string> = new Set();
const clickedStepsListeners = new Set<() => void>();
const clickedStepsSnapshotCache = new Map<string, { raw: string | null; value: ReadonlySet<string> }>();

function notifyClickedStepsChanged(): void {
  for (const listener of clickedStepsListeners) listener();
}

function subscribeClickedSteps(listener: () => void): () => void {
  clickedStepsListeners.add(listener);
  // A change in another tab fires the native `storage` event; reflect it too.
  const onStorage = () => listener();
  window.addEventListener('storage', onStorage);
  return () => {
    clickedStepsListeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

function getClickedStepsSnapshot(venueId: string): ReadonlySet<string> {
  const key = clickedStepsStorageKey(venueId);
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    raw = null;
  }
  const cached = clickedStepsSnapshotCache.get(key);
  if (cached && cached.raw === raw) return cached.value;
  const value: ReadonlySet<string> = new Set(readClickedStepsFromStorage(venueId));
  clickedStepsSnapshotCache.set(key, { raw, value });
  return value;
}

function useClickedSteps(venueId: string): ReadonlySet<string> {
  const getSnapshot = useCallback(() => getClickedStepsSnapshot(venueId), [venueId]);
  const getServerSnapshot = useCallback(() => EMPTY_CLICKED_STEPS, []);
  return useSyncExternalStore(subscribeClickedSteps, getSnapshot, getServerSnapshot);
}

/** Record a click-through prompt as done (localStorage) and re-render subscribers. */
function markStepClicked(venueId: string, stepKey: string): void {
  writeClickedStepToStorage(venueId, stepKey);
  notifyClickedStepsChanged();
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

export function getSteps(status: SetupStatus): Step[] {
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
    base.push(getGuestBookingStep(model));
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
  // Post-onboarding "What's next" prompts, shown alongside the required steps.
  if (onboardingDone) {
    base.push(...POST_ONBOARDING_SETUP_STEPS);
  }
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

  const [confirmingDismiss, setConfirmingDismiss] = useState(false);

  // `completeOnClick` prompts complete once the user clicks through to their page.
  const clickedSteps = useClickedSteps(venueId);

  const steps = useMemo(() => (status ? getSteps(status) : []), [status]);

  const incompleteSteps = useMemo(
    () => (status ? steps.filter((s) => !isStepComplete(status, s, clickedSteps)) : steps),
    [steps, status, clickedSteps],
  );

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

  const completedCount = steps.filter((s) => isStepComplete(status, s, clickedSteps)).length;
  const totalCount = steps.length;
  if (totalCount > 0 && completedCount === totalCount) return null;

  const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

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
                onClick={() => setConfirmingDismiss(true)}
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
                  onClick={step.completeOnClick ? () => markStepClicked(venueId, step.key) : undefined}
                  className="flex-shrink-0 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-xs font-semibold text-brand-800 shadow-sm transition-colors hover:bg-brand-100"
                >
                  {step.actionLabel}
                </Link>
              </li>
            ))}
          </ul>
        </SectionCard.Body>
      </SectionCard>

      <Dialog
        open={confirmingDismiss}
        onOpenChange={(open) => {
          if (!open) setConfirmingDismiss(false);
        }}
        title="Dismiss the setup steps?"
        description="This hides the What's next checklist from your dashboard."
        size="sm"
        footer={
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setConfirmingDismiss(false)}>
              Keep showing
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={() => {
                setConfirmingDismiss(false);
                dismiss();
              }}
            >
              Dismiss setup steps
            </Button>
          </div>
        }
      >
        <p className="text-sm text-slate-600">
          Anything you have not set up yet is still available from the dashboard menu whenever you
          are ready.
        </p>
      </Dialog>
    </div>
  );
}
