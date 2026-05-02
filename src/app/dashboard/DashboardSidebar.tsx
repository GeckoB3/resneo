'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/browser';
import { useDismissibleLayer } from '@/lib/ui/use-dismissible-layer';

import { mergeModelNavEntries } from '@/lib/booking/enabled-models';
import type { BookingModel } from '@/types/booking-models';
import { isAppointmentDashboardExperience } from '@/lib/booking/unified-scheduling';
import {
  isVenueScheduleCalendarEligible,
  shouldShowAppointmentAvailabilitySettings,
} from '@/lib/booking/schedule-calendar-eligibility';
import { isRestaurantTableProductTier } from '@/lib/tier-enforcement';

/**
 * Sidebar visibility matrix (maintainers: keep in sync with route guards and `lib/booking/schedule-calendar-eligibility.ts`).
 *
 * **Tier:** `venues.pricing_tier` — restaurant | founding → table SKU (`isRestaurantTableProductTier`); otherwise appointments SKU.
 *
 * **All roles:** Home, New Booking, Support, external booking page (if slug). Staff and admin see the same links unless noted.
 *
 * **Admin only:** Dining Availability (`/dashboard/availability`), Reports. Matches redirects on those pages.
 * **All roles:** Contacts (`/dashboard/contacts`) — CRM list + guest detail (uses venue staff APIs).
 *
 * **Staff:** Settings link → label **Account**; page is account-only (`settings/page.tsx`). Reports and Dining Availability are omitted from nav.
 *
 * **Restaurant/founding + table primary:** Day Sheet + Bookings grouped (when not using table-management bundle); optional Table Grid + Floor Plan under Bookings when `table_management_enabled`. Injected **Appointment Calendar** (`/dashboard/calendar`) when `isVenueScheduleCalendarEligible`.
 *
 * **Calendar Availability** (`/dashboard/calendar-availability`): when `shouldShowAppointmentAvailabilitySettings` (unified/practitioner primary, or C/D/E primary/secondary).
 *
 * **Model links:** Services, Events, Classes, Resources from `MODEL_NAV_ITEMS` + `mergeModelNavEntries` by primary and `enabled_models`.
 *
 * **Waitlist:** only when `booking_model === 'table_reservation'`.
 */
type NavItem = { href: string; label: string; icon: React.ComponentType<{ className?: string }> };

const BASE_NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Home', icon: HomeIcon },
  { href: '/dashboard/bookings', label: 'Bookings', icon: CalendarIcon },
  { href: '/dashboard/bookings/new', label: 'New Booking', icon: PlusIcon },
  { href: '/dashboard/contacts', label: 'Contacts', icon: UsersIcon },
  { href: '/dashboard/waitlist', label: 'Waitlist', icon: QueueIcon },
  { href: '/dashboard/availability', label: 'Dining Availability', icon: ClockIcon },
  { href: '/dashboard/calendar-availability', label: 'Calendar Availability', icon: CalendarIcon },
  { href: '/dashboard/reports', label: 'Reports', icon: ChartIcon },
  { href: '/dashboard/settings', label: 'Settings', icon: CogIcon },
];

const MODEL_NAV_ITEMS: Partial<Record<BookingModel, NavItem[]>> = {
  practitioner_appointment: [{ href: '/dashboard/appointment-services', label: 'Services', icon: ClockIcon }],
  unified_scheduling: [{ href: '/dashboard/appointment-services', label: 'Services', icon: ClockIcon }],
  event_ticket: [
    { href: '/dashboard/event-manager', label: 'Events', icon: CalendarIcon },
  ],
  class_session: [
    { href: '/dashboard/class-timetable', label: 'Classes', icon: CalendarIcon },
  ],
  resource_booking: [
    { href: '/dashboard/resource-timeline', label: 'Resources', icon: CalendarIcon },
  ],
};

const TABLE_RESERVATION_ONLY = new Set(['/dashboard/waitlist']);

export interface DashboardSidebarProps {
  email: string;
  staffName?: string;
  venueName?: string;
  venueSlug?: string;
  tableManagementEnabled?: boolean;
  /** Restaurant / Founding tier — with `table_reservation` and `tableManagementEnabled`, shows table grid / floor plan. */
  pricingTier?: string;
  bookingModel?: BookingModel;
  /** Secondary bookable models (C/D/E); merged into model-specific nav. */
  enabledModels?: BookingModel[];
  /** Reports nav item is admin-only; dining availability is admin-only; calendar follows venue model rules. */
  isAdmin?: boolean;
  /** Venue `terminology` JSONB - drives booking list / new-booking labels (plan §6.4). */
  venueTerminology?: Record<string, unknown> | null;
}

const ADMIN_ONLY_HREFS = new Set(['/dashboard/reports', '/dashboard/settings']);

function NavLeadingDot({ active }: { active: boolean }) {
  return (
    <span
      className={`h-1.5 w-1.5 shrink-0 rounded-full ${active ? 'bg-brand-600' : 'bg-slate-300 opacity-0 transition-opacity group-hover:opacity-100'}`}
      aria-hidden
    />
  );
}

function NavLinkItem({
  href,
  label,
  icon: Icon,
  active,
  onNavigate,
  external = false,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  onNavigate: () => void;
  external?: boolean;
}) {
  const router = useRouter();
  const className = `group flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
    active
      ? 'bg-white text-brand-800 shadow-sm ring-1 ring-slate-100'
      : 'text-slate-600 hover:bg-white/70 hover:text-slate-900'
  }`;
  const iconClass = `h-5 w-5 flex-shrink-0 ${active ? 'text-brand-600' : 'text-slate-400'}`;
  const content = (
    <>
      <NavLeadingDot active={active} />
      <Icon className={iconClass} />
      <span className="min-w-0 flex-1 whitespace-normal break-words leading-snug">{label}</span>
    </>
  );
  if (external) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onNavigate}
        className={className}
      >
        {content}
        <span className="sr-only"> (opens in new tab)</span>
      </a>
    );
  }
  return (
    <Link
      href={href}
      onClick={onNavigate}
      onPointerEnter={() => {
        void router.prefetch(href);
      }}
      aria-current={active ? 'page' : undefined}
      className={className}
    >
      {content}
    </Link>
  );
}

export function DashboardSidebar({
  email,
  staffName,
  venueName,
  venueSlug,
  tableManagementEnabled,
  pricingTier = 'appointments',
  bookingModel = 'table_reservation',
  enabledModels = [],
  isAdmin = false,
  venueTerminology: _venueTerminology = null,
}: DashboardSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const asideRef = useRef<HTMLElement>(null);

  const closeMobile = useCallback(() => setMobileOpen(false), []);

  // Escape to close
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  useDismissibleLayer({
    open: mobileOpen,
    refs: [asideRef],
    onDismiss: () => setMobileOpen(false),
  });

  /** Restaurant / Founding / legacy Business — matches table-management and SMS tier checks. */
  const isRestaurantPlanTier = isRestaurantTableProductTier(pricingTier);

  const showTableManagementNav =
    Boolean(tableManagementEnabled) &&
    bookingModel === 'table_reservation' &&
    isRestaurantPlanTier;

  const calendarEligible = useMemo(
    () => isVenueScheduleCalendarEligible(bookingModel, enabledModels),
    [bookingModel, enabledModels],
  );

  const isRestaurantTablePrimary = bookingModel === 'table_reservation' && isRestaurantPlanTier;

  const navItems = useMemo(() => {
    const isTableReservation = bookingModel === 'table_reservation';
    const isRestaurantTablePrimaryInner = isTableReservation && isRestaurantPlanTier;
    const isAppointment = isAppointmentDashboardExperience(pricingTier, bookingModel, enabledModels);
    /** Dining covers / Model A — restaurant SKU only (not Appointments or Standard tier). */
    const showDiningAvailability = isTableReservation && isRestaurantPlanTier;
    const showCalendarAvailability = shouldShowAppointmentAvailabilitySettings(bookingModel, enabledModels);

    let items = BASE_NAV_ITEMS.filter((item) => {
      if (!isTableReservation && TABLE_RESERVATION_ONLY.has(item.href)) return false;
      if (item.href === '/dashboard/availability') {
        if (!showDiningAvailability) return false;
        if (!isAdmin) return false;
        return true;
      }
      if (item.href === '/dashboard/calendar-availability') {
        if (!showCalendarAvailability) return false;
        return true;
      }
      if (!isAdmin && ADMIN_ONLY_HREFS.has(item.href)) {
        // Staff can open Settings for personal account only (not full venue settings).
        if (item.href === '/dashboard/settings') return true;
        return false;
      }
      return true;
    });

    if (!isAdmin) {
      items = items.map((item) =>
        item.href === '/dashboard/settings' ? { ...item, label: 'Account' } : item,
      );
    }

    const hasSecondaryModels = enabledModels.length > 0;
    if (isAppointment) {
      items = items.map((item) => {
        if (item.href === '/dashboard/bookings') {
          return { ...item, label: hasSecondaryModels ? 'Bookings' : 'Appointments' };
        }
        if (item.href === '/dashboard/bookings/new') {
          return { ...item, label: hasSecondaryModels ? 'New Booking' : 'New Appointment' };
        }
        return item;
      });
    }

    const modelItems = mergeModelNavEntries(MODEL_NAV_ITEMS, bookingModel, enabledModels);
    if (modelItems.length > 0) {
      const waitIdx = items.findIndex((i) => i.href === '/dashboard/waitlist');
      if (waitIdx >= 0) {
        items = [...items.slice(0, waitIdx + 1), ...modelItems, ...items.slice(waitIdx + 1)];
      } else {
        const newIdx = items.findIndex((i) => i.href === '/dashboard/bookings/new');
        if (newIdx >= 0) {
          items = [...items.slice(0, newIdx + 1), ...modelItems, ...items.slice(newIdx + 1)];
        } else {
          items = [...items, ...modelItems];
        }
      }
    }

    /**
     * Restaurant plan + table primary + schedule calendar: Appointment Calendar sits after Bookings / table
     * views and before New Booking (and merged model links), not down by Waitlist.
     */
    if (isRestaurantTablePrimaryInner && calendarEligible) {
      const calItem: NavItem = { href: '/dashboard/calendar', label: 'Appointment Calendar', icon: CalendarIcon };
      const newIdx = items.findIndex((i) => i.href === '/dashboard/bookings/new');
      const alreadyHasCal = items.some((i) => i.href === '/dashboard/calendar');
      if (!alreadyHasCal && newIdx >= 0) {
        items = [...items.slice(0, newIdx), calItem, ...items.slice(newIdx)];
      }
    }

    return items;
  }, [isAdmin, bookingModel, enabledModels, isRestaurantPlanTier, calendarEligible, pricingTier]);

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
      router.push('/login');
      router.refresh();
    } finally {
      // Leave disabled briefly — navigation unmounts this component anyway.
    }
  }

  const isActive = (href: string) => {
    if (href === '/dashboard') {
      return pathname === '/dashboard';
    }
    if (href === '/dashboard/bookings') {
      return pathname === '/dashboard/bookings';
    }
    if (href === '/dashboard/calendar') {
      return (
        pathname === '/dashboard/calendar' ||
        pathname.startsWith('/dashboard/calendar/') ||
        pathname.startsWith('/dashboard/practitioner-calendar')
      );
    }
    return pathname.startsWith(href);
  };

  const venueInitial = (venueName ?? staffName ?? email).charAt(0).toUpperCase();

  return (
    <>
      {/* Mobile top bar — fixed 3.5rem content height to match the layout's pt-[calc(3.5rem+…)] offset. */}
      <div
        className="fixed top-0 right-0 left-0 z-40 border-b border-slate-200/80 bg-white/95 pt-[env(safe-area-inset-top,0px)] backdrop-blur-md lg:hidden"
      >
        <div className="flex h-14 items-center px-3">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setMobileOpen(!mobileOpen)}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100"
              aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'}
              aria-expanded={mobileOpen}
              aria-controls="dashboard-sidebar"
            >
              {mobileOpen ? <XIcon /> : <MenuIcon />}
            </button>
            <img src="/Logo.png" alt="Reserve NI" className="h-7 w-auto shrink-0" />
            {venueName ? (
              <span
                className="min-w-0 truncate pl-1 text-sm font-semibold text-slate-800"
                title={venueName}
              >
                {venueName}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {/* Sidebar */}
      <aside
        id="dashboard-sidebar"
        ref={asideRef}
        aria-label="Primary"
        className={`
        fixed left-2 top-[calc(4rem+env(safe-area-inset-top,0px))] z-40 flex h-[calc(100dvh-4.5rem-env(safe-area-inset-top,0px))] w-64 flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-slate-50/95 shadow-2xl shadow-slate-900/15 backdrop-blur-md
        transition-transform duration-200 ease-in-out
        ${mobileOpen ? 'translate-x-0' : '-translate-x-[calc(100%+1rem)]'}
        lg:static lg:top-0 lg:h-full lg:min-h-0 lg:translate-x-0 lg:self-stretch lg:z-auto lg:rounded-none lg:border-y-0 lg:border-l-0 lg:shadow-sm
      `}
      >
        {/* Nav links */}
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-3 pb-4" aria-label="Dashboard">
          {navItems.map((item) => {
            if (item.href === '/dashboard/bookings' && !showTableManagementNav) {
              if (isRestaurantTablePrimary) {
                /** Day Sheet + Bookings: restaurant table venues (with or without schedule calendar secondaries). */
                return (
                  <div key="reservations-with-day-sheet" className="space-y-1">
                    <NavLinkItem
                      href="/dashboard/day-sheet"
                      label="Day Sheet"
                      icon={ClipboardIcon}
                      active={pathname.startsWith('/dashboard/day-sheet')}
                      onNavigate={closeMobile}
                    />
                    <NavLinkItem
                      href={item.href}
                      label={item.label}
                      icon={item.icon}
                      active={isActive(item.href)}
                      onNavigate={closeMobile}
                    />
                  </div>
                );
              }

              /** Legacy `table_reservation` on Appointments/Standard SKU: single list link. */
              if (bookingModel === 'table_reservation' && !isRestaurantPlanTier) {
                return (
                  <NavLinkItem
                    key={item.href}
                    href={item.href}
                    label={item.label}
                    icon={item.icon}
                    active={isActive(item.href)}
                    onNavigate={closeMobile}
                  />
                );
              }

              const scheduleActive = calendarEligible
                ? pathname.startsWith('/dashboard/calendar') || pathname.startsWith('/dashboard/practitioner-calendar')
                : pathname.startsWith('/dashboard/day-sheet');
              return (
                <div key="reservations-with-day-sheet" className="space-y-1">
                  <NavLinkItem
                    href={item.href}
                    label={item.label}
                    icon={item.icon}
                    active={isActive(item.href)}
                    onNavigate={closeMobile}
                  />
                  <NavLinkItem
                    href={calendarEligible ? '/dashboard/calendar' : '/dashboard/day-sheet'}
                    label={calendarEligible ? 'Appointment Calendar' : 'Day Sheet'}
                    icon={calendarEligible ? CalendarIcon : ClipboardIcon}
                    active={scheduleActive}
                    onNavigate={closeMobile}
                  />
                </div>
              );
            }

            if (item.href === '/dashboard/bookings' && showTableManagementNav) {
              return (
                <div key="reservations-with-table-views" className="space-y-1">
                  <NavLinkItem
                    href={item.href}
                    label={item.label}
                    icon={item.icon}
                    active={isActive(item.href)}
                    onNavigate={closeMobile}
                  />
                  <NavLinkItem
                    href="/dashboard/table-grid"
                    label="Table Grid"
                    icon={TableGridIcon}
                    active={pathname.startsWith('/dashboard/table-grid')}
                    onNavigate={closeMobile}
                  />
                  <NavLinkItem
                    href="/dashboard/floor-plan"
                    label="Floor Plan"
                    icon={MapIcon}
                    active={pathname.startsWith('/dashboard/floor-plan')}
                    onNavigate={closeMobile}
                  />
                </div>
              );
            }

            return (
              <NavLinkItem
                key={item.href}
                href={item.href}
                label={item.label}
                icon={item.icon}
                active={isActive(item.href)}
                onNavigate={closeMobile}
              />
            );
          })}

          {/* Your Booking Page - external link */}
          {venueSlug && (
            <NavLinkItem
              href={`/book/${venueSlug}`}
              label="Your Booking Page"
              icon={ExternalLinkIcon}
              active={false}
              onNavigate={closeMobile}
              external
            />
          )}
        </nav>

        {/* Footer */}
        <div className="space-y-3 border-t border-slate-100/80 bg-white/60 px-3 py-4 pb-[max(1rem,env(safe-area-inset-bottom,0px))]">
          <div className="rounded-xl border border-slate-100 bg-white p-3 shadow-sm">
            <div className="flex items-center gap-3">
              <div
                aria-hidden
                className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800 ring-2 ring-white"
              >
                {venueInitial}
              </div>
              <div className="min-w-0 flex-1">
                {venueName ? (
                  <p className="truncate text-xs font-semibold text-slate-900" title={venueName}>
                    {venueName}
                  </p>
                ) : null}
                {staffName ? <p className="truncate text-xs font-medium text-slate-700">{staffName}</p> : null}
                <p className="truncate text-[11px] text-slate-500" title={email}>
                  {email}
                </p>
              </div>
            </div>
          </div>
          <NavLinkItem
            href="/dashboard/support"
            label="Support"
            icon={SupportIcon}
            active={pathname.startsWith('/dashboard/support')}
            onNavigate={closeMobile}
          />
          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-600 shadow-sm transition-colors hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </aside>
    </>
  );
}

function UsersIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.48-3.397M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z"
      />
    </svg>
  );
}

function HomeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
    </svg>
  );
}

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
    </svg>
  );
}

function ClipboardIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15a2.25 2.25 0 0 1 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25Z" />
    </svg>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  );
}

function ChartIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
    </svg>
  );
}

function CogIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
    </svg>
  );
}

function QueueIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
    </svg>
  );
}

function ClockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  );
}

function ExternalLinkIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
    </svg>
  );
}

function TableGridIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 0 1-1.125-1.125M3.375 19.5h7.5c.621 0 1.125-.504 1.125-1.125m-9.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-7.5A1.125 1.125 0 0 1 12 18.375m9.75-12.75c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125m19.5 0v1.5c0 .621-.504 1.125-1.125 1.125M2.25 5.625v1.5c0 .621.504 1.125 1.125 1.125m0 0h17.25m-17.25 0h7.5c.621 0 1.125.504 1.125 1.125M3.375 8.25c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m17.25-3.75h-7.5c-.621 0-1.125.504-1.125 1.125m8.625-1.125c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125m-17.25 0h7.5m-7.5 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125M12 10.875v-1.5m0 1.5c0 .621-.504 1.125-1.125 1.125M12 10.875c0 .621.504 1.125 1.125 1.125m-2.25 0c.621 0 1.125.504 1.125 1.125M10.875 12c-.621 0-1.125.504-1.125 1.125M12 12c.621 0 1.125.504 1.125 1.125m-2.25 0c.621 0 1.125.504 1.125 1.125m0 0v1.5c0 .621-.504 1.125-1.125 1.125" />
    </svg>
  );
}

function MapIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498l4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 00-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0z" />
    </svg>
  );
}

function SupportIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 5.25h.008v.008H12v-.008Z" />
    </svg>
  );
}

