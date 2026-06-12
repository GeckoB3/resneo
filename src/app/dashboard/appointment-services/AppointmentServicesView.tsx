'use client';

import { Button } from '@/components/ui/primitives/Button';
import { Dialog } from '@/components/ui/primitives/Dialog';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { defaultNewUnifiedCalendarWorkingHours } from '@/lib/availability/practitioner-defaults';
import { currencySymbolFromCode } from '@/lib/money/currency-symbol';
import { mergeAppointmentServiceWithPractitionerLink } from '@/lib/appointments/merge-service-with-overrides';
import { toServiceCustomScheduleV2 } from '@/lib/service-custom-availability';
import type {
  AppointmentCatalogAddonGroup,
  AppointmentService,
  ClassPaymentRequirement,
  PractitionerService,
  ProcessingTimeBlock,
  ServiceCustomScheduleStored,
  ServiceVariant,
  WorkingHours,
} from '@/types/booking-models';
import { parseServiceLocationType } from '@/types/booking-models';
import { parseProcessingTimeBlocksFromDb } from '@/lib/appointments/processing-time';
import {
  DEFAULT_APPOINTMENT_SERVICE_FORM_VALUES,
  DEFAULT_STAFF_MAY_CUSTOMIZE,
  type AppointmentServiceFormValues,
} from '@/components/dashboard/appointment-services/appointment-service-form-values';
import { AppointmentServiceFormFields } from '@/components/dashboard/appointment-services/AppointmentServiceFormFields';
import { appointmentServiceFormToPayload } from '@/components/dashboard/appointment-services/appointment-service-form-to-payload';
import { DEFAULT_ENTITY_BOOKING_WINDOW } from '@/lib/booking/entity-booking-window';
import type { OpeningHours } from '@/types/availability';
import type { VenueOpeningException } from '@/types/venue-opening-exceptions';
import { parseVenueOpeningExceptions } from '@/types/venue-opening-exceptions';
import { formatPricePenceForServiceCatalog } from '@/lib/booking/format-price-display';
import { StaffServiceOverrideModal } from './StaffServiceOverrideModal';
import { canAddCalendarColumn, useCalendarEntitlement } from '@/hooks/use-calendar-entitlement';
import { CalendarLimitMessage } from '@/components/dashboard/CalendarLimitMessage';
import { PageHeader } from '@/components/ui/dashboard/PageHeader';
import { DashboardEntityRowActions } from '@/components/ui/dashboard/DashboardEntityRowActions';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import { ComplianceRequirementsEditor } from '@/components/dashboard/compliance/ComplianceRequirementsEditor';
import { useAppointmentsFeatureFlag } from '@/components/providers/VenueFeatureFlagsProvider';
import { Pill } from '@/components/ui/dashboard/Pill';
import { DashboardCardGridSkeleton } from '@/components/ui/dashboard/DashboardSkeletons';
import { EmptyState } from '@/components/ui/dashboard/EmptyState';
import { TabBar } from '@/components/ui/dashboard/TabBar';
import { AddonsLibraryView } from '@/app/dashboard/addons/AddonsLibraryView';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

interface Service {
  id: string;
  /** Staff row id of the creator; non-admins may edit/delete only when this matches their staff id. */
  created_by_staff_id?: string | null;
  name: string;
  description: string | null;
  duration_minutes: number;
  buffer_minutes: number;
  price_pence: number | null;
  deposit_pence: number | null;
  payment_requirement?: ClassPaymentRequirement;
  colour: string;
  is_active: boolean;
  sort_order: number;
  max_advance_booking_days?: number;
  min_booking_notice_hours?: number;
  cancellation_notice_hours?: number;
  allow_same_day_booking?: boolean;
  booking_interval_minutes?: number;
  booking_minute_marks?: number[] | null;
  staff_may_customize_name?: boolean;
  staff_may_customize_description?: boolean;
  staff_may_customize_duration?: boolean;
  staff_may_customize_buffer?: boolean;
  staff_may_customize_price?: boolean;
  staff_may_customize_deposit?: boolean;
  staff_may_customize_colour?: boolean;
  custom_availability_enabled?: boolean;
  custom_working_hours?: ServiceCustomScheduleStored | null;
  /** Optional sub-options the customer must pick from before completing a booking. */
  variants?: ServiceVariant[];
  /** Linked add-on groups, returned from the dashboard API. */
  addon_groups?: AppointmentCatalogAddonGroup[];
  processing_time_blocks?: ProcessingTimeBlock[];
  /** Where the service is delivered; omitted/null = business venue (legacy rows). */
  location_type?: string | null;
  online_meeting_url?: string | null;
  online_meeting_info?: string | null;
}


interface Practitioner {
  id: string;
  name: string;
  /** When false, the calendar is hidden from allocation (still listed for resolving names on existing links). */
  is_active?: boolean;
  calendar_type?: string;
  working_hours?: WorkingHours | null;
}

interface PractitionerServiceLink {
  practitioner_id: string;
  service_id: string;
  custom_duration_minutes?: number | null;
  custom_price_pence?: number | null;
  custom_name?: string | null;
  custom_description?: string | null;
  custom_buffer_minutes?: number | null;
  custom_deposit_pence?: number | null;
  custom_colour?: string | null;
}


function formatDuration(mins: number): string {
  if (mins < 60) return `${mins}min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

function penceToPounds(pence: number | null): string {
  if (pence == null) return '';
  return (pence / 100).toFixed(2);
}

export function AppointmentServicesView({
  isAdmin,
  currentStaffId,
  linkedPractitionerIds = [],
  currency = 'GBP',
  stripeConnected = false,
}: {
  isAdmin: boolean;
  /** Logged-in venue staff id (for creator checks when `isAdmin` is false). */
  currentStaffId?: string | null;
  /** Bookable calendars (`unified_calendars.id`) this staff user manages. */
  linkedPractitionerIds?: string[];
  currency?: string;
  /** Venue has `stripe_connected_account_id` — required for online deposits / full payment. */
  stripeConnected?: boolean;
}) {
  const sym = currencySymbolFromCode(currency);

  function formatPrice(pence: number | null): string {
    return formatPricePenceForServiceCatalog(pence, sym);
  }

  const [services, setServices] = useState<Service[]>([]);
  const [practitioners, setPractitioners] = useState<Practitioner[]>([]);
  const [links, setLinks] = useState<PractitionerServiceLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<AppointmentServiceFormValues>(DEFAULT_APPOINTMENT_SERVICE_FORM_VALUES);
  const [saving, setSaving] = useState(false);
  const complianceEnabled = useAppointmentsFeatureFlag('compliance_records_enabled');
  const [error, setError] = useState<string | null>(null);

  // Tab navigation: "services" (default) or "addons". Synced to the URL via
  // `?tab=addons` so deep-links and the back button work as expected.
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const initialTab: 'services' | 'addons' =
    searchParams.get('tab') === 'addons' ? 'addons' : 'services';
  const [activeTab, setActiveTab] = useState<'services' | 'addons'>(initialTab);
  useEffect(() => {
    const t = searchParams.get('tab');
    if (t === 'addons' && activeTab !== 'addons') setActiveTab('addons');
    if (t !== 'addons' && activeTab !== 'services') setActiveTab('services');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
  function changeTab(next: 'services' | 'addons') {
    setActiveTab(next);
    const params = new URLSearchParams(Array.from(searchParams.entries()));
    if (next === 'addons') {
      params.set('tab', 'addons');
    } else {
      params.delete('tab');
    }
    const q = params.toString();
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
  }
  const [linkSavingKey, setLinkSavingKey] = useState<string | null>(null);
  const [overrideService, setOverrideService] = useState<Service | null>(null);
  const [overrideCalendarId, setOverrideCalendarId] = useState<string | null>(null);
  const [showAddCalendarModal, setShowAddCalendarModal] = useState(false);
  const [newCalendarName, setNewCalendarName] = useState('');
  const [creatingCalendar, setCreatingCalendar] = useState(false);
  const [addCalendarModalError, setAddCalendarModalError] = useState<string | null>(null);
  const [serviceToDelete, setServiceToDelete] = useState<{ id: string; name: string } | null>(null);
  const [deleteServiceBusy, setDeleteServiceBusy] = useState(false);
  const [deleteServiceModalError, setDeleteServiceModalError] = useState<string | null>(null);
  const [venueOpeningHours, setVenueOpeningHours] = useState<OpeningHours | null>(null);
  const [venueOpeningExceptions, setVenueOpeningExceptions] = useState<VenueOpeningException[]>([]);

  const {
    entitlement: calendarEntitlement,
    entitlementLoaded,
    refresh: refreshCalendarEntitlement,
  } = useCalendarEntitlement(isAdmin);
  const canAddCalendar = canAddCalendarColumn(calendarEntitlement, entitlementLoaded);

  useEffect(() => {
    if (entitlementLoaded && !canAddCalendar) {
      setShowAddCalendarModal(false);
    }
  }, [entitlementLoaded, canAddCalendar]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [venueRes, svcRes, practRes] = await Promise.all([
        fetch('/api/venue'),
        fetch('/api/venue/appointment-services'),
        fetch('/api/venue/practitioners?roster=1'),
      ]);
      if (!svcRes.ok || !practRes.ok) {
        setError('Failed to load services. Please refresh the page.');
        return;
      }
      if (venueRes.ok) {
        const venueData = (await venueRes.json()) as {
          opening_hours?: OpeningHours | null;
          venue_opening_exceptions?: unknown;
        };
        setVenueOpeningHours(venueData.opening_hours ?? null);
        setVenueOpeningExceptions(parseVenueOpeningExceptions(venueData.venue_opening_exceptions));
      }
      const svcData = await svcRes.json();
      const practData = await practRes.json();
      setServices(svcData.services ?? []);
      setLinks(svcData.practitioner_services ?? []);
      setPractitioners(practData.practitioners ?? []);
    } catch {
      setError('Failed to load services. Please check your connection.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  /** Team calendars that can be allocated services (active, non-resource rows). */
  const allocatableCalendars = useMemo(
    () =>
      practitioners.filter(
        (p) => p.is_active !== false && p.calendar_type !== 'resource',
      ),
    [practitioners],
  );

  /** Staff can only link new or edited services to calendars they manage. */
  const calendarsForServiceForm = useMemo(
    () =>
      isAdmin
        ? allocatableCalendars
        : allocatableCalendars.filter((p) => linkedPractitionerIds.includes(p.id)),
    [isAdmin, allocatableCalendars, linkedPractitionerIds],
  );

  /** IDs still on the service but not in the allocatable list (inactive calendar, etc.). */
  const lingeringCalendarLinks = useMemo(
    () =>
      form.practitioner_ids.filter(
        (id) => !allocatableCalendars.some((c) => c.id === id),
      ),
    [form.practitioner_ids, allocatableCalendars],
  );

  const linkedCalendarsForPreview = useMemo(
    () =>
      form.practitioner_ids
        .map((id) => practitioners.find((p) => p.id === id))
        .filter((p): p is Practitioner => Boolean(p))
        .map((p) => ({
          id: p.id,
          working_hours: p.working_hours ?? {},
        })),
    [form.practitioner_ids, practitioners],
  );

  /** Admins manage definitions for everyone. Non-admins see the full venue list read-only; they edit what they offer under Availability. */
  const visibleServices = useMemo(() => {
    if (isAdmin) return services;
    if (linkedPractitionerIds.length === 0) return [];
    return services;
  }, [isAdmin, services, linkedPractitionerIds.length]);

  function staffMayCustomizeAny(svc: Service): boolean {
    return Boolean(
      svc.staff_may_customize_name ||
        svc.staff_may_customize_description ||
        svc.staff_may_customize_duration ||
        svc.staff_may_customize_buffer ||
        svc.staff_may_customize_price ||
        svc.staff_may_customize_deposit ||
        svc.staff_may_customize_colour,
    );
  }

  function staffOffersService(serviceId: string): boolean {
    if (linkedPractitionerIds.length === 0) return false;
    for (const pid of linkedPractitionerIds) {
      const mine = links.filter((l) => l.practitioner_id === pid);
      if (mine.length === 0) continue;
      if (mine.some((l) => l.service_id === serviceId)) return true;
    }
    return false;
  }

  function calendarOffersService(calendarId: string, serviceId: string): boolean {
    const mine = links.filter((l) => l.practitioner_id === calendarId);
    if (mine.length === 0) return false;
    return mine.some((l) => l.service_id === serviceId);
  }

  async function toggleStaffServiceCalendar(serviceId: string, calendarId: string, nextEnabled: boolean) {
    setLinkSavingKey(`${serviceId}:${calendarId}`);
    setError(null);
    try {
      const explicit = links.filter((l) => l.practitioner_id === calendarId).map((l) => l.service_id);
      const baseline = explicit;
      const nextServiceIds = nextEnabled
        ? Array.from(new Set([...baseline, serviceId]))
        : baseline.filter((id) => id !== serviceId);
      const res = await fetch('/api/venue/practitioner-services', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ practitioner_id: calendarId, service_ids: nextServiceIds }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error ?? 'Failed to update service allocation');
      }
      await fetchAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update service allocation');
    } finally {
      setLinkSavingKey(null);
    }
  }

  function myLinkForService(serviceId: string, calendarPractitionerId?: string): PractitionerService | null {
    const pid = calendarPractitionerId ?? linkedPractitionerIds[0];
    if (!pid) return null;
    const row = links.find((l) => l.practitioner_id === pid && l.service_id === serviceId);
    if (!row) return null;
    return {
      id: '',
      practitioner_id: row.practitioner_id,
      service_id: row.service_id,
      custom_duration_minutes: row.custom_duration_minutes ?? null,
      custom_price_pence: row.custom_price_pence ?? null,
      custom_name: row.custom_name ?? null,
      custom_description: row.custom_description ?? null,
      custom_buffer_minutes: row.custom_buffer_minutes ?? null,
      custom_deposit_pence: row.custom_deposit_pence ?? null,
      custom_colour: row.custom_colour ?? null,
    };
  }

  function openCreate() {
    const defaultCalendarIds = calendarsForServiceForm.map((p) => p.id);
    setForm({
      ...DEFAULT_APPOINTMENT_SERVICE_FORM_VALUES,
      staffMay: { ...DEFAULT_STAFF_MAY_CUSTOMIZE },
      variants: [],
      addon_group_links: [],
      practitioner_ids: defaultCalendarIds,
    });
    setEditingId(null);
    setError(null);
    setShowAddCalendarModal(false);
    setNewCalendarName('');
    setAddCalendarModalError(null);
    setShowModal(true);
  }

  function openEdit(svc: Service) {
    const svcLinks = links.filter((l) => l.service_id === svc.id).map((l) => l.practitioner_id);
    setForm({
      name: svc.name,
      description: svc.description ?? '',
      duration_minutes: svc.duration_minutes,
      buffer_minutes: svc.buffer_minutes,
      price: penceToPounds(svc.price_pence),
      deposit: penceToPounds(svc.deposit_pence),
      payment_requirement:
        svc.payment_requirement ??
        (svc.deposit_pence != null && svc.deposit_pence > 0 ? 'deposit' : 'none'),
      colour: svc.colour || '#3B82F6',
      is_active: svc.is_active,
      practitioner_ids: svcLinks,
      staffMay: {
        name: svc.staff_may_customize_name ?? false,
        description: svc.staff_may_customize_description ?? false,
        duration: svc.staff_may_customize_duration ?? false,
        buffer: svc.staff_may_customize_buffer ?? false,
        price: svc.staff_may_customize_price ?? false,
        deposit: svc.staff_may_customize_deposit ?? false,
        colour: svc.staff_may_customize_colour ?? false,
      },
      max_advance_booking_days:
        svc.max_advance_booking_days ?? DEFAULT_ENTITY_BOOKING_WINDOW.max_advance_booking_days,
      min_booking_notice_hours:
        svc.min_booking_notice_hours ?? DEFAULT_ENTITY_BOOKING_WINDOW.min_booking_notice_hours,
      cancellation_notice_hours:
        svc.cancellation_notice_hours ?? DEFAULT_ENTITY_BOOKING_WINDOW.cancellation_notice_hours,
      allow_same_day_booking:
        svc.allow_same_day_booking ?? DEFAULT_ENTITY_BOOKING_WINDOW.allow_same_day_booking,
      booking_interval_minutes:
        svc.booking_interval_minutes ?? DEFAULT_APPOINTMENT_SERVICE_FORM_VALUES.booking_interval_minutes,
      booking_minute_marks: svc.booking_minute_marks ?? null,
      custom_availability_enabled: svc.custom_availability_enabled ?? false,
      custom_working_hours:
        svc.custom_availability_enabled && svc.custom_working_hours && typeof svc.custom_working_hours === 'object'
          ? toServiceCustomScheduleV2(svc.custom_working_hours)
          : { version: 2, rules: [] },
      processing_time_blocks: parseProcessingTimeBlocksFromDb(
        (svc as { processing_time_blocks?: unknown }).processing_time_blocks,
      ),
      variants: (svc.variants ?? []).map((v) => ({
        id: v.id,
        name: v.name,
        description: v.description ?? '',
        duration_minutes: v.duration_minutes,
        buffer_minutes: v.buffer_minutes,
        price: penceToPounds(v.price_pence),
        deposit: penceToPounds(v.deposit_pence),
        is_active: v.is_active,
        processing_time_blocks: parseProcessingTimeBlocksFromDb(
          (v as { processing_time_blocks?: unknown }).processing_time_blocks,
        ),
      })),
      addon_group_links: (svc as { addon_groups?: unknown }).addon_groups
        ? ((svc as { addon_groups: AppointmentCatalogAddonGroup[] }).addon_groups)
        : [],
      location_type: parseServiceLocationType(svc.location_type),
      online_meeting_url: svc.online_meeting_url ?? '',
      online_meeting_info: svc.online_meeting_info ?? '',
    });
    setEditingId(svc.id);
    setError(null);
    setShowAddCalendarModal(false);
    setNewCalendarName('');
    setAddCalendarModalError(null);
    setShowModal(true);
  }

  async function handleCreateCalendar() {
    const name = newCalendarName.trim();
    if (!name) {
      setAddCalendarModalError('Enter a display name for the calendar.');
      return;
    }
    setCreatingCalendar(true);
    setAddCalendarModalError(null);
    try {
      const res = await fetch('/api/venue/practitioners', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          is_active: true,
          working_hours: defaultNewUnifiedCalendarWorkingHours(),
          break_times: [],
          days_off: [],
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        id?: string;
        name?: string;
        upgrade_required?: boolean;
      };
      if (!res.ok) {
        if (res.status === 403 && data.upgrade_required) {
          setAddCalendarModalError(data.error ?? 'Calendar limit reached for your plan.');
        } else {
          setAddCalendarModalError(data.error ?? 'Failed to create calendar');
        }
        return;
      }
      const newId = data.id;
      if (!newId) {
        setAddCalendarModalError('Calendar was created but no id was returned. Refresh the page.');
        return;
      }
      await fetchAll();
      void refreshCalendarEntitlement();
      setForm((f) => ({
        ...f,
        practitioner_ids: f.practitioner_ids.includes(newId) ? f.practitioner_ids : [...f.practitioner_ids, newId],
      }));
      setNewCalendarName('');
      setShowAddCalendarModal(false);
    } catch {
      setAddCalendarModalError('Failed to create calendar');
    } finally {
      setCreatingCalendar(false);
    }
  }

  async function handleSave() {
    const built = appointmentServiceFormToPayload(form, { isAdmin, editingId });
    if (!built.ok) {
      setError(built.error);
      return;
    }
    const { payload } = built;

    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/venue/appointment-services', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          details?: string;
        };
        const baseMsg = data.error ?? 'Failed to save service';
        throw new Error(data.details ? `${baseMsg} ${data.details}` : baseMsg);
      }

      setShowModal(false);
      await fetchAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function confirmDeleteService() {
    if (!serviceToDelete) return;
    setDeleteServiceBusy(true);
    setDeleteServiceModalError(null);
    try {
      const res = await fetch('/api/venue/appointment-services', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: serviceToDelete.id }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setDeleteServiceModalError(json.error ?? 'Failed to delete service. Please try again.');
        return;
      }
      await fetchAll();
      setServiceToDelete(null);
    } catch {
      setDeleteServiceModalError('Failed to delete service. Please try again.');
    } finally {
      setDeleteServiceBusy(false);
    }
  }

  function closeDeleteServiceModal() {
    setServiceToDelete(null);
    setDeleteServiceModalError(null);
  }

  function toggleCalendarLink(calendarId: string) {
    setForm((prev) => ({
      ...prev,
      practitioner_ids: prev.practitioner_ids.includes(calendarId)
        ? prev.practitioner_ids.filter((p) => p !== calendarId)
        : [...prev.practitioner_ids, calendarId],
    }));
  }

  function removeCalendarLink(calendarId: string) {
    setForm((prev) => ({
      ...prev,
      practitioner_ids: prev.practitioner_ids.filter((p) => p !== calendarId),
    }));
  }

  function practitionersForService(serviceId: string): Array<{ id: string; name: string }> {
    return practitioners
      .filter((p) => p.calendar_type !== 'resource')
      .filter((p) => calendarOffersService(p.id, serviceId))
      .map((p) => ({ id: p.id, name: p.name }));
  }

  const showServicesTab = activeTab === 'services';

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Appointments"
        title={showServicesTab ? 'Services' : 'Services & add-ons'}
        subtitle={
          showServicesTab
            ? !isAdmin
              ? linkedPractitionerIds.length === 0
                ? 'Ask an admin to assign you to a calendar in Team settings before you can add services or manage offers.'
                : 'Add services and link them only to calendars you control. Use Availability → Services to toggle which columns offer each service.'
              : 'Define what guests can book, pricing, buffers, and online payment rules.'
            : isAdmin
              ? 'Build reusable add-on groups. Link them to one or many services from each service’s edit form.'
              : 'Add-on groups configured by your venue admin.'
        }
        actions={
          showServicesTab && (isAdmin || linkedPractitionerIds.length > 0) ? (
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-700"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path d="M12 5v14m-7-7h14" />
              </svg>
              Add service
            </button>
          ) : null
        }
      />

      <TabBar
        tabs={[
          { id: 'services', label: 'Services' },
          { id: 'addons', label: 'Add-ons' },
        ] as const}
        value={activeTab}
        onChange={changeTab}
        mobileNote={null}
      />

      {activeTab === 'addons' ? (
        <AddonsLibraryView isAdmin={isAdmin} currencySymbol={sym} embedded />
      ) : (
        <>
      {!showModal && error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-2 text-red-400 hover:text-red-600">&times;</button>
        </div>
      )}

      {loading ? (
        <DashboardCardGridSkeleton cards={3} />
      ) : services.length === 0 ? (
        <EmptyState
          title="No services yet"
          description="Create your catalogue of bookable services with duration, pricing, and optional deposits."
          action={
            isAdmin || linkedPractitionerIds.length > 0 ? (
              <button
                type="button"
                onClick={openCreate}
                className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-700"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path d="M12 5v14m-7-7h14" />
                </svg>
                Add your first service
              </button>
            ) : undefined
          }
        />
      ) : !isAdmin && linkedPractitionerIds.length === 0 ? (
        <SectionCard className="border-amber-200 bg-amber-50/50">
          <SectionCard.Body className="py-8 text-center">
            <p className="text-sm text-amber-950">
              Your account is not linked to a calendar yet. Ask an admin to connect your user account to a calendar in
              Availability → Team, then return here.
            </p>
          </SectionCard.Body>
        </SectionCard>
      ) : (
        <div className="space-y-3">
          {visibleServices.map((svc) => {
            const linkedCalendars = practitionersForService(svc.id);
            const display = mergeAppointmentServiceWithPractitionerLink(
              svc as unknown as AppointmentService,
              !isAdmin && linkedPractitionerIds.length > 0
                ? myLinkForService(svc.id) ?? undefined
                : undefined,
            );
            return (
              <SectionCard key={svc.id} className={!svc.is_active ? 'opacity-75' : ''}>
                <SectionCard.Header
                  title={display.name}
                  description={
                    display.description ? (
                      <span className="line-clamp-2">{display.description}</span>
                    ) : undefined
                  }
                  right={
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <span
                        className="h-3 w-3 shrink-0 rounded-full ring-1 ring-slate-200/80"
                        style={{ backgroundColor: display.colour }}
                        aria-hidden
                      />
                      <Pill variant="neutral" size="sm">
                        {formatDuration(display.duration_minutes)}
                      </Pill>
                      {(svc.variants?.filter((v) => v.is_active).length ?? 0) > 0 ? (
                        <Pill variant="brand" size="sm">
                          {svc.variants!.filter((v) => v.is_active).length} variant
                          {svc.variants!.filter((v) => v.is_active).length === 1 ? '' : 's'}
                        </Pill>
                      ) : null}
                      {!svc.is_active ? (
                        <Pill variant="warning" size="sm">
                          Inactive
                        </Pill>
                      ) : null}
                    </div>
                  }
                />
                <SectionCard.Body className="!pt-0">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1 space-y-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
                    {display.buffer_minutes > 0 ? (
                      <Pill variant="neutral" size="sm">
                        +{display.buffer_minutes}min buffer
                      </Pill>
                    ) : null}
                    <Pill variant="brand" size="sm">
                      {formatPrice(display.price_pence)}
                    </Pill>
                    {(() => {
                      const pr =
                        display.payment_requirement ??
                        (display.deposit_pence != null && display.deposit_pence > 0 ? 'deposit' : 'none');
                      if (pr === 'full_payment') {
                        return (
                          <Pill variant="success" size="sm">
                            Full payment online
                          </Pill>
                        );
                      }
                      if (pr === 'deposit' && display.deposit_pence != null && display.deposit_pence > 0) {
                        return (
                          <Pill variant="neutral" size="sm">
                            {formatPrice(display.deposit_pence)} deposit
                          </Pill>
                        );
                      }
                      return (
                        <Pill variant="neutral" size="sm">
                          No online payment
                        </Pill>
                      );
                    })()}
                  </div>
                      {!isAdmin &&
                        linkedPractitionerIds.length > 0 &&
                        (
                          <div className="mt-3 space-y-2">
                            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3 shadow-sm shadow-slate-900/5">
                              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                                Offer on your calendars
                              </p>
                              <div className="space-y-2">
                                {linkedPractitionerIds.map((calendarId) => {
                                  const calendar = practitioners.find((p) => p.id === calendarId);
                                  const enabled = calendarOffersService(calendarId, svc.id);
                                  return (
                                    <label
                                      key={calendarId}
                                      className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                                    >
                                      <span>{calendar?.name ?? 'Calendar'}</span>
                                      <input
                                        type="checkbox"
                                        checked={enabled}
                                        disabled={linkSavingKey === `${svc.id}:${calendarId}`}
                                        onChange={(e) =>
                                          void toggleStaffServiceCalendar(svc.id, calendarId, e.target.checked)
                                        }
                                        className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                      />
                                    </label>
                                  );
                                })}
                              </div>
                            </div>
                            {staffOffersService(svc.id) && staffMayCustomizeAny(svc) && (
                              <button
                                type="button"
                                onClick={() => {
                                  setOverrideCalendarId(linkedPractitionerIds[0] ?? null);
                                  setOverrideService(svc);
                                }}
                                className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-brand-700"
                              >
                                Edit your settings
                              </button>
                            )}
                          </div>
                        )}
                      {linkedCalendars.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {linkedCalendars.map((lp) => {
                            const isSelf = Boolean(
                              !isAdmin && linkedPractitionerIds.includes(lp.id),
                            );
                            const variant = isAdmin ? 'brand' : isSelf ? 'success' : 'neutral';
                            return (
                              <Pill key={lp.id} variant={variant} size="sm">
                                {lp.name}
                                {!isAdmin && linkedPractitionerIds.length > 0 ? (
                                  <span className="ml-1 font-normal text-slate-500">
                                    {linkedPractitionerIds.includes(lp.id) ? '(your calendar)' : '(view only)'}
                                  </span>
                                ) : null}
                              </Pill>
                            );
                          })}
                        </div>
                      )}
                    </div>

                  {(isAdmin ||
                    (linkedPractitionerIds.length > 0 &&
                      Boolean(currentStaffId) &&
                      svc.created_by_staff_id === currentStaffId)) && (
                    <div className="flex flex-shrink-0 items-center sm:pt-1">
                      <DashboardEntityRowActions
                        onEdit={() => openEdit(svc)}
                        onDelete={() => {
                          setDeleteServiceModalError(null);
                          setServiceToDelete({ id: svc.id, name: svc.name });
                        }}
                      />
                    </div>
                  )}
                  </div>
                </SectionCard.Body>
              </SectionCard>
            );
          })}
        </div>
      )}
        </>
      )}

      <Dialog
        open={showModal}
        onOpenChange={(open) => {
          if (!open) setShowModal(false);
        }}
        title={editingId ? 'Edit Service' : 'Add Service'}
        size="lg"
        contentClassName="max-w-4xl"
        footer={
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setShowModal(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={handleSave} loading={saving} disabled={saving}>
              {saving ? 'Saving...' : editingId ? 'Save Changes' : 'Create Service'}
            </Button>
          </div>
        }
      >
        {error && (
              <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
            )}

            <AppointmentServiceFormFields
              form={form}
              setForm={setForm}
              isAdmin={isAdmin}
              stripeConnected={stripeConnected}
              currencySymbol={sym}
              fieldGroupSuffix={editingId ?? 'new-service'}
              venueOpeningHours={venueOpeningHours}
              venueOpeningExceptions={venueOpeningExceptions}
              linkedCalendarsForPreview={linkedCalendarsForPreview}
              calendarsSection={
                calendarsForServiceForm.length > 0 ||
                lingeringCalendarLinks.length > 0 ||
                practitioners.length === 0 ? (
                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-700">
                      Calendars that offer this service
                    </label>
                    <p className="mb-2 text-xs text-slate-500">Tick the calendars that should offer this service.</p>
                    {isAdmin && (
                      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                        {!entitlementLoaded ? (
                          <p className="text-xs text-slate-500">Loading plan limits…</p>
                        ) : canAddCalendar ? (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setAddCalendarModalError(null);
                                setNewCalendarName('');
                                setShowAddCalendarModal(true);
                              }}
                              className="inline-flex w-full items-center justify-center rounded-lg border border-brand-200/90 bg-white px-3.5 py-2.5 text-sm font-semibold text-brand-700 shadow-sm transition-[color,background-color,border-color,box-shadow,transform] duration-150 ease-out hover:border-brand-400 hover:bg-brand-50 hover:text-brand-800 hover:shadow-md active:scale-[0.98] active:border-brand-500 active:bg-brand-100 active:shadow-inner motion-reduce:transition-colors motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 sm:w-auto"
                            >
                              Add calendar
                            </button>
                            <Link
                              href="/dashboard/calendar-availability?tab=calendars"
                              className="text-sm text-slate-600 underline hover:text-slate-800"
                            >
                              Calendar availability
                            </Link>
                          </>
                        ) : (
                          <div className="rounded-lg border border-amber-200 bg-amber-50/90 px-4 py-3 text-sm text-amber-950">
                            <CalendarLimitMessage
                              entitlement={calendarEntitlement}
                              linkClassName="font-medium text-brand-700 underline hover:text-brand-800"
                            />
                          </div>
                        )}
                      </div>
                    )}
                    {practitioners.length === 0 && (
                      <p className="text-sm text-slate-500">
                        No calendars found for this venue. Add calendars in Availability → Team.
                      </p>
                    )}
                    {practitioners.length > 0 && lingeringCalendarLinks.length > 0 && (
                      <div className="mb-3 space-y-2">
                        {lingeringCalendarLinks.map((id) => {
                          const row = practitioners.find((pr) => pr.id === id);
                          return (
                            <div
                              key={id}
                              className="flex min-h-[2.5rem] flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50/90 px-3 py-2"
                            >
                              <span className="text-sm text-slate-800">
                                <span className="font-medium">{row?.name ?? 'Unknown'}</span>
                                <span className="ml-1.5 text-xs font-normal text-amber-900">
                                  (not available — calendar inactive or not eligible)
                                </span>
                              </span>
                              <button
                                type="button"
                                onClick={() => removeCalendarLink(id)}
                                className="shrink-0 text-xs font-medium text-slate-600 underline hover:text-red-700"
                              >
                                Remove link
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {practitioners.length > 0 &&
                      (calendarsForServiceForm.length > 0 ? (
                        <div className="space-y-2">
                          {calendarsForServiceForm.map((p) => (
                            <label
                              key={p.id}
                              className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 hover:bg-slate-50"
                            >
                              <input
                                type="checkbox"
                                checked={form.practitioner_ids.includes(p.id)}
                                onChange={() => toggleCalendarLink(p.id)}
                                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                              />
                              <span className="text-sm text-slate-700">{p.name}</span>
                            </label>
                          ))}
                        </div>
                      ) : lingeringCalendarLinks.length === 0 ? (
                        <p className="text-sm text-slate-500">
                          No active calendars to assign. Add or reactivate a calendar in Team first.
                        </p>
                      ) : null)}
                  </div>
                ) : null
              }
              hideStaffMaySection={false}
              staffNotice={
                !isAdmin ? (
                  <p className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    Link this service to at least one calendar you control. Only venue admins can change which fields
                    other staff may customise for their calendars.
                  </p>
                ) : undefined
              }
            />

            {editingId && complianceEnabled && (
              <div className="mt-6">
                <ComplianceRequirementsEditor
                  appointmentServiceId={editingId}
                  complianceEnabled={complianceEnabled}
                />
              </div>
            )}

      </Dialog>



      {isAdmin ? (
        <Dialog
          open={showAddCalendarModal}
          onOpenChange={(open) => {
            if (creatingCalendar) return;
            if (!open) {
              setShowAddCalendarModal(false);
              setAddCalendarModalError(null);
            }
          }}
          title="Add calendar"
          description="Same defaults as Calendar availability: weekly hours are set automatically; you can edit them later."
          size="sm"
          footer={
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => void handleCreateCalendar()} loading={creatingCalendar} disabled={creatingCalendar}>
                {creatingCalendar ? 'Creating…' : 'Create and assign'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setShowAddCalendarModal(false);
                  setAddCalendarModalError(null);
                }}
                disabled={creatingCalendar}
              >
                Cancel
              </Button>
            </div>
          }
        >
          {addCalendarModalError ? (
            <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {addCalendarModalError}
            </div>
          ) : null}
          <label className="mb-1 block text-xs font-medium text-slate-600">Display name *</label>
          <input
            type="text"
            value={newCalendarName}
            onChange={(e) => setNewCalendarName(e.target.value)}
            placeholder="e.g. Room 2, Senior stylist"
            disabled={creatingCalendar}
            className="mb-4 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 disabled:opacity-60"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleCreateCalendar();
              }
            }}
          />
        </Dialog>
      ) : null}



      <Dialog
        open={serviceToDelete != null}
        onOpenChange={(open) => {
          if (!open && !deleteServiceBusy) closeDeleteServiceModal();
        }}
        title="Delete this service?"
        description={
          serviceToDelete
            ? `${serviceToDelete.name} will be removed. Calendar links to this service will be cleared. This cannot be undone.`
            : undefined
        }
        size="sm"
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" onClick={closeDeleteServiceModal} disabled={deleteServiceBusy}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={() => void confirmDeleteService()}
              loading={deleteServiceBusy}
              disabled={deleteServiceBusy}
            >
              {deleteServiceBusy ? 'Deleting…' : 'Delete service'}
            </Button>
          </div>
        }
      >
        {deleteServiceModalError ? (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {deleteServiceModalError}
          </div>
        ) : null}
      </Dialog>



      {overrideService && linkedPractitionerIds.length > 0 && (
        <StaffServiceOverrideModal
          open={Boolean(overrideService)}
          onClose={() => {
            setOverrideService(null);
            setOverrideCalendarId(null);
          }}
          onSaved={() => void fetchAll()}
          service={overrideService}
          link={myLinkForService(
            overrideService.id,
            overrideCalendarId ?? linkedPractitionerIds[0],
          )}
          calendarChoices={linkedPractitionerIds.map((id) => ({
            id,
            name: practitioners.find((p) => p.id === id)?.name ?? 'Calendar',
          }))}
          selectedCalendarId={overrideCalendarId ?? linkedPractitionerIds[0]}
          onSelectedCalendarChange={setOverrideCalendarId}
          currency={currency}
        />
      )}
    </div>
  );
}
