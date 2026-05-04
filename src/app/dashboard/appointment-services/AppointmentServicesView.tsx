'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { defaultNewUnifiedCalendarWorkingHours } from '@/lib/availability/practitioner-defaults';
import { currencySymbolFromCode } from '@/lib/money/currency-symbol';
import { mergeAppointmentServiceWithPractitionerLink } from '@/lib/appointments/merge-service-with-overrides';
import {
  isServiceCustomScheduleEmpty,
  toServiceCustomScheduleV2,
} from '@/lib/service-custom-availability';
import type {
  AppointmentService,
  ClassPaymentRequirement,
  PractitionerService,
  ProcessingTimeBlock,
  ServiceCustomScheduleStored,
  ServiceCustomScheduleV2,
  ServiceVariant,
  WorkingHours,
} from '@/types/booking-models';
import { parseProcessingTimeBlocksFromDb } from '@/lib/appointments/processing-time';
import { ProcessingTimeTimelineEditor } from '@/components/dashboard/appointment-services/ProcessingTimeTimelineEditor';
import { ServiceCustomAvailabilityEditor } from '@/components/scheduling/ServiceCustomAvailabilityEditor';
import { ServiceAvailabilityCalendar } from '@/components/scheduling/ServiceAvailabilityCalendar';
import { DEFAULT_ENTITY_BOOKING_WINDOW } from '@/lib/booking/entity-booking-window';
import type { OpeningHours } from '@/types/availability';
import type { VenueOpeningException } from '@/types/venue-opening-exceptions';
import { parseVenueOpeningExceptions } from '@/types/venue-opening-exceptions';
import { formatPricePenceForServiceCatalog } from '@/lib/booking/format-price-display';
import { StripePaymentWarning } from '@/components/dashboard/StripePaymentWarning';
import { HelpTooltip } from '@/components/dashboard/HelpTooltip';
import { StaffServiceOverrideModal } from './StaffServiceOverrideModal';
import { canAddCalendarColumn, useCalendarEntitlement } from '@/hooks/use-calendar-entitlement';
import { CalendarLimitMessage } from '@/components/dashboard/CalendarLimitMessage';
import { NumericInput } from '@/components/ui/NumericInput';
import { PageHeader } from '@/components/ui/dashboard/PageHeader';
import { DashboardEntityRowActions } from '@/components/ui/dashboard/DashboardEntityRowActions';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import { Pill } from '@/components/ui/dashboard/Pill';
import { DashboardCardGridSkeleton } from '@/components/ui/dashboard/DashboardSkeletons';
import { EmptyState } from '@/components/ui/dashboard/EmptyState';

interface Service {
  id: string;
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
  processing_time_blocks?: ProcessingTimeBlock[];
}

/** One editable row in the variants section of the service modal. Pence values come back as strings while editing. */
interface VariantFormRow {
  /** Existing row id (preserved when editing); empty for newly-added rows. */
  id?: string;
  name: string;
  description: string;
  duration_minutes: number;
  buffer_minutes: number;
  price: string;
  deposit: string;
  is_active: boolean;
  processing_time_blocks: ProcessingTimeBlock[];
}

const DEFAULT_VARIANT_ROW: VariantFormRow = {
  name: '',
  description: '',
  duration_minutes: 30,
  buffer_minutes: 0,
  price: '',
  deposit: '',
  is_active: true,
  processing_time_blocks: [],
};

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

interface ServiceFormData {
  name: string;
  description: string;
  duration_minutes: number;
  buffer_minutes: number;
  price: string;
  deposit: string;
  payment_requirement: ClassPaymentRequirement;
  colour: string;
  is_active: boolean;
  practitioner_ids: string[];
  staffMay: {
    name: boolean;
    description: boolean;
    duration: boolean;
    buffer: boolean;
    price: boolean;
    deposit: boolean;
    colour: boolean;
  };
  max_advance_booking_days: number;
  min_booking_notice_hours: number;
  cancellation_notice_hours: number;
  allow_same_day_booking: boolean;
  custom_availability_enabled: boolean;
  custom_working_hours: ServiceCustomScheduleV2;
  /** Optional sub-options. When non-empty, customers must pick one before booking. */
  variants: VariantFormRow[];
  processing_time_blocks: ProcessingTimeBlock[];
}

const COLOUR_OPTIONS = [
  '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6',
  '#EC4899', '#06B6D4', '#84CC16', '#F97316', '#6366F1',
];

const DEFAULT_STAFF_MAY: ServiceFormData['staffMay'] = {
  name: false,
  description: false,
  duration: false,
  buffer: false,
  price: false,
  deposit: false,
  colour: false,
};

const DEFAULT_FORM: ServiceFormData = {
  name: '',
  description: '',
  duration_minutes: 30,
  buffer_minutes: 0,
  price: '',
  deposit: '',
  payment_requirement: 'none',
  colour: '#3B82F6',
  is_active: true,
  practitioner_ids: [],
  staffMay: { ...DEFAULT_STAFF_MAY },
  max_advance_booking_days: DEFAULT_ENTITY_BOOKING_WINDOW.max_advance_booking_days,
  min_booking_notice_hours: DEFAULT_ENTITY_BOOKING_WINDOW.min_booking_notice_hours,
  cancellation_notice_hours: 24,
  allow_same_day_booking: DEFAULT_ENTITY_BOOKING_WINDOW.allow_same_day_booking,
  custom_availability_enabled: false,
  custom_working_hours: { version: 2, rules: [] },
  variants: [],
  processing_time_blocks: [],
};

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

function poundsToPence(pounds: string): number | null {
  const trimmed = pounds.trim();
  if (!trimmed) return null;
  const num = parseFloat(trimmed);
  if (Number.isNaN(num) || num < 0) return null;
  return Math.round(num * 100);
}

export function AppointmentServicesView({
  isAdmin,
  linkedPractitionerIds = [],
  currency = 'GBP',
  stripeConnected = false,
}: {
  isAdmin: boolean;
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
  const [form, setForm] = useState<ServiceFormData>(DEFAULT_FORM);
  /** Admins editing variants: base duration/price fields are hidden; options carry those values. */
  const usesVariants = isAdmin && form.variants.length > 0;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkSavingKey, setLinkSavingKey] = useState<string | null>(null);
  const [overrideService, setOverrideService] = useState<Service | null>(null);
  const [overrideCalendarId, setOverrideCalendarId] = useState<string | null>(null);
  const [showAddCalendarModal, setShowAddCalendarModal] = useState(false);
  const [newCalendarName, setNewCalendarName] = useState('');
  const [creatingCalendar, setCreatingCalendar] = useState(false);
  const [addCalendarModalError, setAddCalendarModalError] = useState<string | null>(null);
  const [serviceToDelete, setServiceToDelete] = useState<{ id: string; name: string } | null>(null);
  const [deleteServiceBusy, setDeleteServiceBusy] = useState(false);
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
    setForm({ ...DEFAULT_FORM, staffMay: { ...DEFAULT_STAFF_MAY }, variants: [] });
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
    const usesVariants = isAdmin && form.variants.length > 0;
    const activeVariants = usesVariants ? form.variants.filter((v) => v.is_active) : [];
    if (!form.name.trim()) {
      setError('Service name is required');
      return;
    }
    if (!usesVariants && form.duration_minutes < 5) {
      setError('Duration must be at least 5 minutes');
      return;
    }
    if (form.payment_requirement === 'deposit') {
      const d = poundsToPence(form.deposit);
      if (d == null || d <= 0) {
        setError('Enter a valid deposit amount');
        return;
      }
    }
    if (form.payment_requirement === 'full_payment') {
      if (usesVariants) {
        if (activeVariants.length === 0) {
          setError('Turn on at least one bookable option, or switch back to a single offering.');
          return;
        }
        for (const v of activeVariants) {
          const p = poundsToPence(v.price);
          if (p == null || p <= 0) {
            setError(`Option "${v.name.trim()}": set a price — full online payment applies to each option.`);
            return;
          }
        }
      } else {
        const p = poundsToPence(form.price);
        if (p == null || p <= 0) {
          setError('Set a price when charging full payment online');
          return;
        }
      }
    }

    if (isAdmin && form.custom_availability_enabled && isServiceCustomScheduleEmpty(form.custom_working_hours)) {
      setError('Add at least one custom schedule rule, or turn off custom availability.');
      return;
    }

    if (isAdmin && form.variants.length > 0) {
      if (activeVariants.length === 0) {
        setError('Turn on at least one bookable option, or switch back to a single offering.');
        return;
      }
      for (let i = 0; i < form.variants.length; i++) {
        const v = form.variants[i]!;
        if (!v.name.trim()) {
          setError(`Option ${i + 1}: name is required`);
          return;
        }
        if (v.duration_minutes < 5 || v.duration_minutes > 480) {
          setError(`Option "${v.name.trim()}" duration must be between 5 and 480 minutes`);
          return;
        }
        if (v.price.trim() && poundsToPence(v.price) == null) {
          setError(`Option "${v.name.trim()}" has an invalid price`);
          return;
        }
        if (v.deposit.trim() && poundsToPence(v.deposit) == null) {
          setError(`Option "${v.name.trim()}" has an invalid deposit`);
          return;
        }
      }
    }

    if (!isAdmin && !editingId && form.practitioner_ids.length === 0) {
      setError('Select at least one calendar column to offer this service on.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const usesVariantsPayload = isAdmin && form.variants.length > 0;
      const primaryForParent =
        usesVariantsPayload && form.variants.length > 0
          ? form.variants.find((v) => v.is_active) ?? form.variants[0]
          : null;
      const durationMinutesPayload =
        usesVariantsPayload && primaryForParent ? primaryForParent.duration_minutes : form.duration_minutes;
      const bufferMinutesPayload =
        usesVariantsPayload && primaryForParent ? primaryForParent.buffer_minutes : form.buffer_minutes;
      const priceStrPayload =
        usesVariantsPayload && primaryForParent ? primaryForParent.price : form.price;

      const depositPence =
        form.payment_requirement === 'deposit' ? (poundsToPence(form.deposit) ?? 0) : 0;
      const payload: Record<string, unknown> = {
        ...(editingId ? { id: editingId } : {}),
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        duration_minutes: durationMinutesPayload,
        buffer_minutes: bufferMinutesPayload,
        price_pence: poundsToPence(priceStrPayload) ?? undefined,
        payment_requirement: form.payment_requirement,
        deposit_pence: depositPence,
        colour: form.colour,
        is_active: form.is_active,
        practitioner_ids: form.practitioner_ids,
        max_advance_booking_days: form.max_advance_booking_days,
        min_booking_notice_hours: form.min_booking_notice_hours,
        cancellation_notice_hours: form.cancellation_notice_hours,
        allow_same_day_booking: form.allow_same_day_booking,
      };
      if (isAdmin) {
        payload.staff_may_customize_name = form.staffMay.name;
        payload.staff_may_customize_description = form.staffMay.description;
        payload.staff_may_customize_duration = form.staffMay.duration;
        payload.staff_may_customize_buffer = form.staffMay.buffer;
        payload.staff_may_customize_price = form.staffMay.price;
        payload.staff_may_customize_deposit = form.staffMay.deposit;
        payload.staff_may_customize_colour = form.staffMay.colour;
        payload.custom_availability_enabled = form.custom_availability_enabled;
        payload.custom_working_hours = form.custom_availability_enabled
          ? form.custom_working_hours
          : null;
        payload.processing_time_blocks = usesVariantsPayload ? [] : form.processing_time_blocks;
        payload.variants = form.variants.map((v, idx) => ({
          ...(v.id ? { id: v.id } : {}),
          name: v.name.trim(),
          description: v.description.trim() || null,
          duration_minutes: v.duration_minutes,
          buffer_minutes: v.buffer_minutes,
          price_pence: poundsToPence(v.price),
          deposit_pence: poundsToPence(v.deposit),
          sort_order: idx,
          is_active: v.is_active,
          processing_time_blocks: v.processing_time_blocks,
        }));
      }

      const res = await fetch('/api/venue/appointment-services', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? 'Failed to save service');
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
    setError(null);
    try {
      const res = await fetch('/api/venue/appointment-services', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: serviceToDelete.id }),
      });
      if (!res.ok) {
        setError('Failed to delete service. Please try again.');
        return;
      }
      await fetchAll();
      setServiceToDelete(null);
    } catch {
      setError('Failed to delete service. Please try again.');
    } finally {
      setDeleteServiceBusy(false);
    }
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

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Appointments"
        title="Services"
        subtitle={
          !isAdmin
            ? linkedPractitionerIds.length === 0
              ? 'Ask an admin to assign you to a calendar in Team settings before you can add services or manage offers.'
              : 'Add services and link them only to calendars you control. Use Availability → Services to toggle which columns offer each service.'
            : 'Define what guests can book, pricing, buffers, and online payment rules.'
        }
        actions={
          isAdmin || linkedPractitionerIds.length > 0 ? (
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

                  {(isAdmin || linkedPractitionerIds.length > 0) && (
                    <div className="flex flex-shrink-0 items-center sm:pt-1">
                      <DashboardEntityRowActions
                        onEdit={() => openEdit(svc)}
                        onDelete={() => {
                          setError(null);
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

      {/* Create / Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/25 p-4 backdrop-blur-[2px]">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="service-modal-title"
            className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xl shadow-slate-900/15 ring-1 ring-slate-100"
          >
            <div className="mb-5 flex items-center justify-between">
              <h2 id="service-modal-title" className="text-lg font-semibold text-slate-900">
                {editingId ? 'Edit Service' : 'Add Service'}
              </h2>
              <button onClick={() => setShowModal(false)} aria-label="Close" className="rounded-lg p-1 hover:bg-slate-100">
                <svg className="h-5 w-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
            </div>

            {error && (
              <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
            )}

            {!isAdmin && (
              <p className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                Link this service to at least one calendar you control. Only venue admins can change which fields other
                staff may customise for their calendars.
              </p>
            )}

            <div className="space-y-4">
              {/* Name */}
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Name *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  placeholder="e.g. Consultation, Standard session"
                />
              </div>

              {/* Description */}
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Description</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  rows={2}
                  placeholder="Brief description of the service"
                />
              </div>

              {isAdmin && (
                <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-4 space-y-3">
                  <div>
                    <p className="text-sm font-medium text-slate-800">How will clients book this service?</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Pick one. Use multiple options when length, price, or the type of session changes what the client
                      selects (before they pick a time).
                    </p>
                  </div>
                  <div className="space-y-2">
                    <label
                      className={`flex cursor-pointer gap-3 rounded-xl border bg-white p-3 transition-colors ${
                        !usesVariants
                          ? 'border-brand-300 ring-1 ring-brand-200/60'
                          : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <input
                        type="radio"
                        name="service-booking-mode"
                        className="mt-1 shrink-0"
                        checked={!usesVariants}
                        onChange={() => {
                          if (form.variants.length === 0) return;
                          if (
                            !window.confirm(
                              'Switch to one fixed offering? All bookable options you added will be removed from this service.',
                            )
                          ) {
                            return;
                          }
                          setForm((f) => ({ ...f, variants: [] }));
                        }}
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900">One fixed offering</p>
                        <p className="mt-0.5 text-xs text-slate-600">
                          One duration, buffer, and price. What you set below applies to every booking.
                        </p>
                      </div>
                    </label>
                    <label
                      className={`flex cursor-pointer gap-3 rounded-xl border bg-white p-3 transition-colors ${
                        usesVariants
                          ? 'border-brand-300 ring-1 ring-brand-200/60'
                          : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <input
                        type="radio"
                        name="service-booking-mode"
                        className="mt-1 shrink-0"
                        checked={usesVariants}
                        onChange={() => {
                          setForm((f) => {
                            if (f.variants.length > 0) return f;
                            return {
                              ...f,
                              variants: [
                                {
                                  ...DEFAULT_VARIANT_ROW,
                                  duration_minutes: f.duration_minutes,
                                  buffer_minutes: f.buffer_minutes,
                                  price: f.price,
                                  deposit: f.payment_requirement === 'deposit' ? f.deposit : '',
                                },
                              ],
                            };
                          });
                        }}
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900">Multiple bookable options</p>
                        <p className="mt-0.5 text-xs text-slate-600">
                          Clients choose an option first. Each option has its own duration, buffer, price, optional
                          description, and optional deposit override.
                        </p>
                      </div>
                    </label>
                  </div>
                </div>
              )}

              {usesVariants && (
                <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3 ring-1 ring-slate-100/80">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-slate-800">Bookable options</p>
                      <p className="mt-0.5 max-w-xl text-xs text-slate-500">
                        These values are what guests use when they book. Payment type is still chosen in{' '}
                        <span className="font-medium text-slate-700">Online payment when booking</span> below — for
                        deposits, set a default on the service; leave an option&apos;s deposit blank to use that
                        default.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setForm((f) => {
                          const last = f.variants[f.variants.length - 1];
                          return {
                            ...f,
                            variants: [
                              ...f.variants,
                              {
                                ...DEFAULT_VARIANT_ROW,
                                duration_minutes: last?.duration_minutes ?? DEFAULT_VARIANT_ROW.duration_minutes,
                                buffer_minutes: last?.buffer_minutes ?? 0,
                              },
                            ],
                          };
                        })
                      }
                      className="shrink-0 rounded-lg border border-brand-200 bg-white px-3 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-50"
                    >
                      Add option
                    </button>
                  </div>

                  <div className="space-y-3">
                    {form.variants.map((variant, idx) => (
                      <div
                        key={variant.id ?? `new-${idx}`}
                        className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 space-y-2.5"
                      >
                        <div className="flex items-start gap-2">
                          <input
                            type="text"
                            value={variant.name}
                            onChange={(e) =>
                              setForm((f) => ({
                                ...f,
                                variants: f.variants.map((row, i) =>
                                  i === idx ? { ...row, name: e.target.value } : row,
                                ),
                              }))
                            }
                            placeholder="Option name (e.g. 60 minutes, Full head)"
                            className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setForm((f) => ({
                                ...f,
                                variants: f.variants.filter((_, i) => i !== idx),
                              }))
                            }
                            className="shrink-0 rounded-lg border border-slate-300 px-2.5 py-2 text-xs font-medium text-slate-600 hover:bg-white hover:text-red-700"
                            aria-label={`Remove option ${variant.name || idx + 1}`}
                          >
                            Remove
                          </button>
                        </div>
                        <div>
                          <label className="mb-0.5 block text-[11px] font-medium text-slate-600">
                            Optional description (shown when they pick this option)
                          </label>
                          <textarea
                            value={variant.description}
                            onChange={(e) =>
                              setForm((f) => ({
                                ...f,
                                variants: f.variants.map((row, i) =>
                                  i === idx ? { ...row, description: e.target.value } : row,
                                ),
                              }))
                            }
                            placeholder="e.g. Includes toner — allow 15 extra minutes."
                            rows={2}
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-700 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                          <div>
                            <label className="mb-0.5 block text-[11px] font-medium text-slate-600">
                              Duration (mins) *
                            </label>
                            <NumericInput
                              min={5}
                              max={480}
                              value={variant.duration_minutes}
                              onChange={(v) =>
                                setForm((f) => ({
                                  ...f,
                                  variants: f.variants.map((row, i) =>
                                    i === idx ? { ...row, duration_minutes: v } : row,
                                  ),
                                }))
                              }
                              className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                            />
                          </div>
                          <div>
                            <label className="mb-0.5 block text-[11px] font-medium text-slate-600">
                              Buffer (mins)
                            </label>
                            <NumericInput
                              min={0}
                              max={120}
                              value={variant.buffer_minutes}
                              onChange={(v) =>
                                setForm((f) => ({
                                  ...f,
                                  variants: f.variants.map((row, i) =>
                                    i === idx ? { ...row, buffer_minutes: v } : row,
                                  ),
                                }))
                              }
                              className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                            />
                          </div>
                          <div>
                            <label className="mb-0.5 block text-[11px] font-medium text-slate-600">
                              Price ({sym})
                            </label>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={variant.price}
                              onChange={(e) =>
                                setForm((f) => ({
                                  ...f,
                                  variants: f.variants.map((row, i) =>
                                    i === idx ? { ...row, price: e.target.value } : row,
                                  ),
                                }))
                              }
                              placeholder="0.00"
                              className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                            />
                          </div>
                          <div>
                            <label className="mb-0.5 block text-[11px] font-medium text-slate-600">
                              Deposit ({sym}) <span className="font-normal text-slate-400">optional</span>
                            </label>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={variant.deposit}
                              onChange={(e) =>
                                setForm((f) => ({
                                  ...f,
                                  variants: f.variants.map((row, i) =>
                                    i === idx ? { ...row, deposit: e.target.value } : row,
                                  ),
                                }))
                              }
                              placeholder={
                                form.payment_requirement === 'deposit' ? 'Uses service default' : '—'
                              }
                              className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                            />
                          </div>
                        </div>
                        <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-700">
                          <input
                            type="checkbox"
                            checked={variant.is_active}
                            onChange={(e) =>
                              setForm((f) => ({
                                ...f,
                                variants: f.variants.map((row, i) =>
                                  i === idx ? { ...row, is_active: e.target.checked } : row,
                                ),
                              }))
                            }
                            className="h-3.5 w-3.5 rounded border-slate-300"
                          />
                          Offer this option to clients
                        </label>
                        {isAdmin ? (
                          <ProcessingTimeTimelineEditor
                            compact
                            durationMinutes={variant.duration_minutes}
                            bufferMinutes={variant.buffer_minutes}
                            blocks={variant.processing_time_blocks}
                            onChange={(blocks) =>
                              setForm((f) => ({
                                ...f,
                                variants: f.variants.map((row, i) =>
                                  i === idx ? { ...row, processing_time_blocks: blocks } : row,
                                ),
                              }))
                            }
                          />
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!usesVariants && (
                <>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700">Duration (mins) *</label>
                      <NumericInput
                        value={form.duration_minutes}
                        onChange={(v) => setForm({ ...form, duration_minutes: v })}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                        min={5}
                        max={480}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700">Buffer (mins)</label>
                      <NumericInput
                        value={form.buffer_minutes}
                        onChange={(v) => setForm({ ...form, buffer_minutes: v })}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                        min={0}
                        max={120}
                      />
                    </div>
                  </div>

                  {isAdmin ? (
                    <ProcessingTimeTimelineEditor
                      durationMinutes={form.duration_minutes}
                      bufferMinutes={form.buffer_minutes}
                      blocks={form.processing_time_blocks}
                      onChange={(blocks) => setForm((f) => ({ ...f, processing_time_blocks: blocks }))}
                    />
                  ) : null}

                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">Price ({sym})</label>
                    <div className="relative max-w-[200px]">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">{sym}</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={form.price}
                        onChange={(e) => setForm({ ...form, price: e.target.value })}
                        className="w-full rounded-lg border border-slate-300 pl-7 pr-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                        placeholder="0.00"
                      />
                    </div>
                  </div>
                </>
              )}

              {usesVariants ? (
                <p className="rounded-lg border border-amber-100 bg-amber-50/80 px-3 py-2 text-xs text-amber-950/90">
                  <span className="font-semibold">Payment &amp; booking rules below apply to every option.</span> For
                  full online payment, each turned-on option must have a price. For deposits, the service default
                  deposit fills in when an option&apos;s deposit is left blank.
                </p>
              ) : null}

              {/* Online payment at booking */}
              <SectionCard>
                <SectionCard.Header title="Online payment when booking" />
                <SectionCard.Body className="!pt-0 space-y-3">
                <div className="space-y-2">
                  <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-700">
                    <input
                      type="radio"
                      name="payment_requirement"
                      className="mt-0.5"
                      checked={form.payment_requirement === 'none'}
                      onChange={() => setForm((f) => ({ ...f, payment_requirement: 'none' }))}
                    />
                    <span>No online payment (pay at venue or arrange separately)</span>
                  </label>
                  <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-700">
                    <input
                      type="radio"
                      name="payment_requirement"
                      className="mt-0.5"
                      checked={form.payment_requirement === 'deposit'}
                      onChange={() => setForm((f) => ({ ...f, payment_requirement: 'deposit' }))}
                    />
                    <span>Custom deposit (fixed amount online)</span>
                  </label>
                  <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-700">
                    <input
                      type="radio"
                      name="payment_requirement"
                      className="mt-0.5"
                      checked={form.payment_requirement === 'full_payment'}
                      onChange={() => setForm((f) => ({ ...f, payment_requirement: 'full_payment' }))}
                    />
                    <span>Pay full price online at booking</span>
                  </label>
                </div>
                {form.payment_requirement === 'deposit' && (
                  <div>
                    <label className="mb-1 block text-sm text-slate-600">
                      {usesVariants ? (
                        <>
                          Default deposit ({sym}){' '}
                          <span className="font-normal text-slate-500">
                            — used when an option leaves its deposit field blank
                          </span>
                        </>
                      ) : (
                        <>Deposit amount ({sym})</>
                      )}
                    </label>
                    <div className="relative max-w-[200px]">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">{sym}</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={form.deposit}
                        onChange={(e) => setForm({ ...form, deposit: e.target.value })}
                        className="w-full rounded-lg border border-slate-300 pl-7 pr-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                        placeholder="5.00"
                      />
                    </div>
                  </div>
                )}
                {form.payment_requirement === 'full_payment' && (
                  <p className="text-xs text-slate-500">
                    {usesVariants
                      ? 'Each option offered to clients needs its own price — that is what they pay online at booking.'
                      : 'The full service price (above) is charged when the guest completes booking online.'}
                  </p>
                )}
                <StripePaymentWarning
                  stripeConnected={stripeConnected}
                  requiresOnlinePayment={
                    form.payment_requirement === 'deposit' || form.payment_requirement === 'full_payment'
                  }
                />
                </SectionCard.Body>
              </SectionCard>

              {/* Online guest booking rules */}
              <div className="rounded-lg border border-slate-200 p-4 space-y-3">
                <p className="text-sm font-medium text-slate-800">Guest booking rules</p>
                <p className="text-xs text-slate-500">
                  Applies to online bookings for this service (advance window, notice, and deposit refund notice).
                </p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm text-slate-700">Max advance (days)</label>
                    <NumericInput
                      min={1}
                      max={365}
                      value={form.max_advance_booking_days}
                      onChange={(v) => setForm({ ...form, max_advance_booking_days: v })}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm text-slate-700">Min booking notice (hours)</label>
                    <NumericInput
                      min={0}
                      max={168}
                      value={form.min_booking_notice_hours}
                      onChange={(v) => setForm({ ...form, min_booking_notice_hours: v })}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label htmlFor="service-cancellation-notice-hours" className="mb-1 block text-sm text-slate-700">
                      Cancellation notice (hours){' '}
                      <HelpTooltip
                        maxWidth={300}
                        content="This sets when deposits and online payments are refundable until: guests who cancel at least this many hours before the start time get a full refund (subject to your payment settings)."
                      />
                    </label>
                    <NumericInput
                      id="service-cancellation-notice-hours"
                      min={0}
                      max={168}
                      value={form.cancellation_notice_hours}
                      onChange={(v) => setForm({ ...form, cancellation_notice_hours: v })}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div className="flex flex-col justify-end">
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={form.allow_same_day_booking}
                        onChange={(e) =>
                          setForm({ ...form, allow_same_day_booking: e.target.checked })
                        }
                        className="rounded border-slate-300"
                      />
                      Allow same-day bookings
                    </label>
                  </div>
                </div>
              </div>

              {/* Colour */}
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Colour</label>
                <div className="flex flex-wrap gap-2">
                  {COLOUR_OPTIONS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setForm({ ...form, colour: c })}
                      className={`h-8 w-8 rounded-full border-2 transition-all ${
                        form.colour === c ? 'border-slate-900 scale-110' : 'border-transparent'
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>

              {/* Active toggle */}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setForm({ ...form, is_active: !form.is_active })}
                  className={`relative h-6 w-11 rounded-full transition-colors ${
                    form.is_active ? 'bg-brand-600' : 'bg-slate-300'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                      form.is_active ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
                <span className="text-sm text-slate-700">Active (visible to clients)</span>
              </div>

              {/* Per-calendar overrides (Model B) — admin sets which fields staff may customise */}
              {isAdmin && (
                <div className="rounded-lg border border-slate-200 bg-slate-50/90 p-4 space-y-3">
                  <p className="text-sm font-medium text-slate-800">Optional overrides per calendar</p>
                  <p className="text-xs text-slate-500">
                    {usesVariants ? (
                      <>
                        Allow staff on a calendar to override these fields for their column only. For services with
                        multiple options, duration, buffer, price, and deposit refer to each bookable option once a
                        client has chosen it.
                      </>
                    ) : (
                      <>
                        Allow staff users assigned to an individual calendar to adjust the following values for their
                        calendar only. Leave unticked and all calendars use the value set above.
                      </>
                    )}
                  </p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {(
                      [
                        ['name', 'Display name'],
                        ['description', 'Description'],
                        ['duration', 'Duration'],
                        ['buffer', 'Buffer time'],
                        ['price', 'Price'],
                        ['deposit', 'Deposit'],
                        ['colour', 'Colour'],
                      ] as const
                    ).map(([key, label]) => (
                      <label key={key} className="flex items-center gap-2 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          checked={form.staffMay[key]}
                          onChange={(e) =>
                            setForm((prev) => ({
                              ...prev,
                              staffMay: { ...prev.staffMay, [key]: e.target.checked },
                            }))
                          }
                          className="h-4 w-4 rounded border-slate-300 text-blue-600"
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Calendar allocation */}
              {(calendarsForServiceForm.length > 0 ||
                lingeringCalendarLinks.length > 0 ||
                practitioners.length === 0) && (
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">
                    Calendars that offer this service
                  </label>
                  <p className="mb-2 text-xs text-slate-500">
                    Tick the calendars that should offer this service.
                  </p>
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
              )}

              <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
                <div>
                  <p className="text-sm font-medium text-slate-800">When guests can book this service online</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Final availability is the overlap of venue opening hours, each linked calendar&apos;s
                    hours, and this service&apos;s schedule (below). Staff blocks and one-off calendar
                    changes also apply live.
                  </p>
                </div>
                <ServiceAvailabilityCalendar
                  venueOpeningHours={venueOpeningHours}
                  venueOpeningExceptions={venueOpeningExceptions}
                  linkedCalendars={linkedCalendarsForPreview}
                  customAvailabilityEnabled={form.custom_availability_enabled}
                  customWorkingHours={form.custom_working_hours}
                  footnote="Based on venue hours (with exceptions), each linked calendar's recurring weekly hours, and this service's schedule. Staff blocks and one-off calendar changes are not previewed here."
                />


                {isAdmin ? (
                  <div className="space-y-3 pt-1">
                    <div>
                      <p className="text-sm font-medium text-slate-800">This service&apos;s schedule</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        Optional — only turn on if this service should be bookable for less time than
                        its calendars are open (for example a brunch menu, or evening-only therapy).
                      </p>
                    </div>
                    <ServiceCustomAvailabilityEditor
                      value={form.custom_working_hours}
                      onChange={(next) =>
                        setForm((f) => ({ ...f, custom_working_hours: next }))
                      }
                      enabled={form.custom_availability_enabled}
                      onEnabledChange={(next) =>
                        setForm((f) => ({ ...f, custom_availability_enabled: next }))
                      }
                    />
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">
                    Only venue admins can change this service&apos;s schedule.
                  </p>
                )}
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setShowModal(false)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {saving ? 'Saving...' : editingId ? 'Save Changes' : 'Create Service'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddCalendarModal && isAdmin && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/25 p-4 backdrop-blur-[2px]"
          onClick={() => {
            if (creatingCalendar) return;
            setShowAddCalendarModal(false);
            setAddCalendarModalError(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="appointment-add-calendar-title"
            className="w-full max-w-md rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xl shadow-slate-900/15 ring-1 ring-slate-100"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="appointment-add-calendar-title" className="mb-1 text-lg font-semibold text-slate-900">
              Add calendar
            </h2>
            <p className="mb-4 text-sm text-slate-500">
              Same defaults as Calendar availability: weekly hours are set automatically; you can edit them later.
            </p>
            {addCalendarModalError && (
              <div
                role="alert"
                className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
              >
                {addCalendarModalError}
              </div>
            )}
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
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleCreateCalendar()}
                disabled={creatingCalendar}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {creatingCalendar ? 'Creating…' : 'Create and assign'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowAddCalendarModal(false);
                  setAddCalendarModalError(null);
                }}
                disabled={creatingCalendar}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {serviceToDelete && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/25 p-4 backdrop-blur-[2px]"
          onClick={() => {
            if (!deleteServiceBusy) setServiceToDelete(null);
          }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-service-title"
            aria-describedby="delete-service-desc"
            className="w-full max-w-md rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xl shadow-slate-900/15 ring-1 ring-slate-100"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="delete-service-title" className="text-base font-semibold text-slate-900">
              Delete this service?
            </h3>
            <p id="delete-service-desc" className="mt-2 text-sm text-slate-600">
              <span className="font-medium text-slate-800">{serviceToDelete.name}</span> will be removed. Calendar
              links to this service will be cleared. This cannot be undone.
            </p>
            {error ? (
              <div
                role="alert"
                className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
              >
                {error}
              </div>
            ) : null}
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setServiceToDelete(null)}
                disabled={deleteServiceBusy}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmDeleteService()}
                disabled={deleteServiceBusy}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-700 disabled:opacity-50"
              >
                {deleteServiceBusy ? 'Deleting…' : 'Delete service'}
              </button>
            </div>
          </div>
        </div>
      )}

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
