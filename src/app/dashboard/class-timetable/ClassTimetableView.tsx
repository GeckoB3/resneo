'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { StripePaymentWarning } from '@/components/dashboard/StripePaymentWarning';
import { defaultNewUnifiedCalendarWorkingHours } from '@/lib/availability/practitioner-defaults';
import { ClassScheduleModal } from './ClassScheduleModal';
import { ClassTimetableReadOnlyCalendar } from './ClassTimetableReadOnlyCalendar';
import { ClassTimetableStatsRow } from './ClassTimetableStatsRow';
import { canAddCalendarColumn, useCalendarEntitlement } from '@/hooks/use-calendar-entitlement';
import { CalendarLimitMessage } from '@/components/dashboard/CalendarLimitMessage';
import { NumericInput } from '@/components/ui/NumericInput';
import { PageHeader } from '@/components/ui/dashboard/PageHeader';
import { DashboardEntityRowActions } from '@/components/ui/dashboard/DashboardEntityRowActions';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import { Pill } from '@/components/ui/dashboard/Pill';
import { currencySymbolFromCode } from '@/lib/money/currency-symbol';
import { EmptyState } from '@/components/ui/dashboard/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { ClassInstanceDetailSheet } from '@/components/practitioner-calendar/ClassInstanceDetailSheet';
import type { ScheduleBlockDTO } from '@/types/schedule-blocks';
import { useVenuePostgresLiveSync } from '@/lib/realtime/useVenuePostgresLiveSync';

interface PractitionerOption {
  id: string;
  name: string;
}

type PaymentRequirement = 'none' | 'deposit' | 'full_payment';

interface ClassType {
  id: string;
  name: string;
  description?: string | null;
  duration_minutes: number;
  capacity: number;
  price_pence: number | null;
  colour: string;
  is_active: boolean;
  instructor_id?: string | null;
  /** Host team calendar id (from GET); use with `instructor_id` for staff scope checks. */
  instructor_calendar_id?: string | null;
  instructor_name?: string | null;
  payment_requirement?: PaymentRequirement;
  deposit_amount_pence?: number | null;
  max_advance_booking_days?: number;
  min_booking_notice_hours?: number;
  cancellation_notice_hours?: number;
  allow_same_day_booking?: boolean;
}

interface TimetableEntry {
  id: string;
  class_type_id: string;
  day_of_week: number;
  start_time: string;
  is_active: boolean;
  interval_weeks?: number;
  created_at?: string;
  recurrence_type?: string;
  recurrence_end_date?: string | null;
  total_occurrences?: number | null;
}

interface ClassInstance {
  id: string;
  class_type_id: string;
  instance_date: string;
  start_time: string;
  is_cancelled: boolean;
  cancel_reason: string | null;
  timetable_entry_id?: string | null;
  capacity_override?: number | null;
  booked_spots?: number;
}

type Notice = { kind: 'success' | 'error'; message: string };

const DAY_LABELS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function paymentRuleSummary(ct: ClassType, formatPrice: (pence: number) => string): string {
  const req = ct.payment_requirement ?? 'none';
  if (req === 'none') return 'No online payment';
  if (req === 'full_payment') return 'Full payment online';
  if (req === 'deposit' && ct.deposit_amount_pence != null) {
    return `Deposit ${formatPrice(ct.deposit_amount_pence)}`;
  }
  return 'Deposit online';
}

const BLANK_CT = {
  name: '',
  description: '',
  duration_minutes: 60,
  capacity: 10,
  price_pence: '',
  colour: '#6366f1',
  is_active: true,
  instructor_staff_id: '' as string,
  instructor_custom_name: '',
  payment_requirement: 'none' as PaymentRequirement,
  deposit_pounds: '',
  max_advance_booking_days: 90,
  min_booking_notice_hours: 1,
  cancellation_notice_hours: 48,
  allow_same_day_booking: true,
};

const INITIAL_TIMETABLE_FORM = {
  day_of_week: 1,
  start_time: '09:00',
  interval_weeks: 1,
  end_condition: 'never' as 'never' | 'until' | 'count',
  recurrence_end_date: '',
  total_occurrences: '',
};

function addMinutesToTimeHm(startHm: string, addMinutes: number): string {
  const parts = startHm.slice(0, 5).split(':');
  const h = Number.parseInt(parts[0] ?? '0', 10);
  const m = Number.parseInt(parts[1] ?? '0', 10);
  const total = h * 60 + m + addMinutes;
  const wrapped = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const hh = Math.floor(wrapped / 60);
  const mm = wrapped % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** Synthetic schedule block so Upcoming sessions uses the same detail sheet as dashboard/calendar. */
function buildAgendaClassBlock(inst: ClassInstance, ct: ClassType | undefined): ScheduleBlockDTO {
  const start = inst.start_time.length >= 5 ? inst.start_time.slice(0, 5) : inst.start_time;
  const duration = ct?.duration_minutes ?? 60;
  const cap = inst.capacity_override ?? ct?.capacity ?? 0;
  return {
    id: `class-agenda-${inst.id}`,
    kind: 'class_session',
    date: inst.instance_date,
    start_time: start,
    end_time: addMinutesToTimeHm(start, duration),
    title: ct?.name ?? 'Class',
    subtitle: null,
    class_instance_id: inst.id,
    class_capacity: cap,
    class_booked_spots: inst.booked_spots ?? 0,
    accent_colour: ct?.colour ?? null,
  };
}

export function ClassTimetableView({
  venueId,
  isAdmin,
  linkedPractitionerIds = [],
  currency = 'GBP',
  stripeConnected = false,
  classCommerceEnabled = false,
}: {
  venueId: string;
  isAdmin: boolean;
  linkedPractitionerIds?: string[];
  currency?: string;
  stripeConnected?: boolean;
  classCommerceEnabled?: boolean;
}) {
  const sym = currencySymbolFromCode(currency);
  function formatPrice(pence: number): string {
    return `${sym}${(pence / 100).toFixed(2)}`;
  }

  const [classTypes, setClassTypes] = useState<ClassType[]>([]);
  const [timetable, setTimetable] = useState<TimetableEntry[]>([]);
  const [instances, setInstances] = useState<ClassInstance[]>([]);
  const [practitioners, setPractitioners] = useState<PractitionerOption[]>([]);
  /** Bookable calendars (USE); names usually match staff for class instructor selection. */
  const [unifiedCalendars, setUnifiedCalendars] = useState<PractitionerOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice | null>(null);

  const [scheduledClassFilterId, setScheduledClassFilterId] = useState('all');
  const [classInstanceSheet, setClassInstanceSheet] = useState<{
    instanceId: string;
    block: ScheduleBlockDTO;
  } | null>(null);
  const [classSheetRefresh, setClassSheetRefresh] = useState(0);

  const [showClassTypeForm, setShowClassTypeForm] = useState(false);
  const [editingClassTypeId, setEditingClassTypeId] = useState<string | null>(null);
  const [classTypeForm, setClassTypeForm] = useState({ ...BLANK_CT });
  const [classTypeSaving, setClassTypeSaving] = useState(false);
  const [classTypeError, setClassTypeError] = useState<string | null>(null);
  const [timetableForm, setTimetableForm] = useState({ ...INITIAL_TIMETABLE_FORM });

  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);

  const [editingTimetable, setEditingTimetable] = useState<TimetableEntry | null>(null);
  const [editingInstance, setEditingInstance] = useState<ClassInstance | null>(null);
  const [editInstanceForm, setEditInstanceForm] = useState({ date: '', time: '', capacity: '' });
  const [patchSaving, setPatchSaving] = useState(false);
  const [instanceDeletingId, setInstanceDeletingId] = useState<string | null>(null);
  const [classDeleteDialog, setClassDeleteDialog] = useState<
    | null
    | { kind: 'class_type'; id: string }
    | { kind: 'timetable'; id: string }
    | { kind: 'instance'; inst: ClassInstance }
  >(null);
  const [classDeleteBusy, setClassDeleteBusy] = useState(false);
  const [classDeleteDialogError, setClassDeleteDialogError] = useState<string | null>(null);

  const [showAddCalendarModal, setShowAddCalendarModal] = useState(false);
  const [newCalendarName, setNewCalendarName] = useState('');
  const [addCalendarSubmitting, setAddCalendarSubmitting] = useState(false);
  const [addCalendarModalError, setAddCalendarModalError] = useState<string | null>(null);

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

  const fetchData = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false;
    if (!silent) setLoading(true);
    try {
      const res = await fetch('/api/venue/classes', { cache: 'no-store' });
      const data = await res.json();
      setClassTypes(data.class_types ?? []);
      setTimetable(data.timetable ?? []);
      setInstances(data.instances ?? []);
      setPractitioners(data.practitioners ?? []);
      setUnifiedCalendars(
        isAdmin
          ? (data.unified_calendars ?? [])
          : (data.unified_calendars ?? []).filter((c: PractitionerOption) =>
              linkedPractitionerIds.includes(c.id),
            ),
      );
    } catch {
      setNotice({ kind: 'error', message: 'Failed to load class data.' });
    } finally {
      if (!silent) setLoading(false);
    }
  }, [isAdmin, linkedPractitionerIds]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  /** After mutations, refetch without replacing the whole block with the loading skeleton. */
  const refreshClassData = useCallback(async () => {
    await fetchData({ silent: true });
  }, [fetchData]);

  useVenuePostgresLiveSync({
    venueId,
    onRefresh: () => {
      void refreshClassData();
    },
    subscriptions: [
      { table: 'class_types', filter: `venue_id=eq.${venueId}` },
      { table: 'class_instances' },
      { table: 'class_timetable' },
      { table: 'bookings', filter: `venue_id=eq.${venueId}` },
    ],
  });

  const submitInlineNewCalendar = useCallback(async () => {
    const name = newCalendarName.trim();
    if (!name) {
      setAddCalendarModalError('Enter a display name for the calendar.');
      return;
    }
    setAddCalendarSubmitting(true);
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
      const json = (await res.json()) as {
        error?: string;
        id?: string;
        name?: string;
        upgrade_required?: boolean;
      };
      if (!res.ok) {
        if (res.status === 403 && json.upgrade_required) {
          void refreshCalendarEntitlement();
          setAddCalendarModalError(json.error ?? 'Calendar limit reached for your plan.');
        } else {
          setAddCalendarModalError(json.error ?? 'Could not create calendar');
        }
        return;
      }
      const newId = json.id;
      const newName = typeof json.name === 'string' ? json.name : name;
      if (!newId) {
        setAddCalendarModalError('Calendar was created but no id was returned. Refresh the page.');
        return;
      }
      setUnifiedCalendars((prev) => {
        if (prev.some((c) => c.id === newId)) return prev;
        return [...prev, { id: newId, name: newName }].sort((a, b) => a.name.localeCompare(b.name));
      });
      setPractitioners((prev) => {
        if (prev.some((p) => p.id === newId)) return prev;
        return [...prev, { id: newId, name: newName }].sort((a, b) => a.name.localeCompare(b.name));
      });
      setClassTypeForm((f) => ({ ...f, instructor_staff_id: newId }));
      setNewCalendarName('');
      setShowAddCalendarModal(false);
      setNotice({ kind: 'success', message: `Calendar "${newName}" created and selected.` });
      void fetchData({ silent: true });
      void refreshCalendarEntitlement();
    } catch {
      setAddCalendarModalError('Could not create calendar');
    } finally {
      setAddCalendarSubmitting(false);
    }
  }, [newCalendarName, fetchData, refreshCalendarEntitlement]);

  /** If a session row is removed (e.g. deleted elsewhere), close the detail sheet. */
  useEffect(() => {
    if (classInstanceSheet && !instances.some((i) => i.id === classInstanceSheet.instanceId)) {
      setClassInstanceSheet(null);
    }
  }, [instances, classInstanceSheet]);

  const removeInstanceFromList = useCallback((id: string) => {
    setInstances((prev) => prev.filter((i) => i.id !== id));
    setClassInstanceSheet((s) => (s?.instanceId === id ? null : s));
  }, []);

  useEffect(() => {
    if (!showClassTypeForm) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !showAddCalendarModal) {
        setShowClassTypeForm(false);
        setEditingClassTypeId(null);
        setClassTypeError(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showClassTypeForm, showAddCalendarModal]);

  useEffect(() => {
    if (!showClassTypeForm) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [showClassTypeForm]);

  const typeMap = useMemo(() => new Map(classTypes.map((ct) => [ct.id, ct])), [classTypes]);

  const filteredInstances = useMemo(() => {
    if (scheduledClassFilterId === 'all') return instances;
    return instances.filter((inst) => inst.class_type_id === scheduledClassFilterId);
  }, [instances, scheduledClassFilterId]);

  useEffect(() => {
    if (scheduledClassFilterId === 'all') return;
    if (classTypes.some((ct) => ct.id === scheduledClassFilterId)) return;
    setScheduledClassFilterId('all');
  }, [classTypes, scheduledClassFilterId]);

  useEffect(() => {
    if (
      classInstanceSheet &&
      !filteredInstances.some((i) => i.id === classInstanceSheet.instanceId)
    ) {
      setClassInstanceSheet(null);
    }
  }, [filteredInstances, classInstanceSheet]);

  const staffManagesClassType = useCallback(
    (ct: ClassType | undefined): boolean => {
      if (!ct) return false;
      const calId = ct.instructor_calendar_id ?? ct.instructor_id ?? null;
      return calId != null && linkedPractitionerIds.includes(calId);
    },
    [linkedPractitionerIds],
  );

  const scheduleModalClassTypes = useMemo(() => {
    if (isAdmin) return classTypes;
    return classTypes.filter((ct) => staffManagesClassType(ct));
  }, [isAdmin, classTypes, staffManagesClassType]);

  const canOpenScheduleModal =
    isAdmin || (linkedPractitionerIds.length > 0 && scheduleModalClassTypes.length > 0);

  const stats = useMemo(() => {
    const activeClassTypes = classTypes.filter((c) => c.is_active).length;
    const todayLocal = (() => {
      const n = new Date();
      return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
    })();
    const end7 = new Date();
    end7.setDate(end7.getDate() + 6);
    const weekEndLocal = `${end7.getFullYear()}-${String(end7.getMonth() + 1).padStart(2, '0')}-${String(end7.getDate()).padStart(2, '0')}`;
    const sessionsNext7Days = instances.filter(
      (i) => !i.is_cancelled && i.instance_date >= todayLocal && i.instance_date <= weekEndLocal,
    ).length;
    const upcomingSessions = instances.filter((i) => !i.is_cancelled).length;
    const totalBookedSpots = instances.reduce((sum, i) => sum + (i.booked_spots ?? 0), 0);
    return { activeClassTypes, sessionsNext7Days, upcomingSessions, totalBookedSpots };
  }, [classTypes, instances]);

  const resolveCalendarColumnLabel = useCallback(
    (ct: ClassType): string => {
      const calId = ct.instructor_calendar_id ?? ct.instructor_id;
      if (calId) {
        const hit = unifiedCalendars.find((c) => c.id === calId);
        if (hit) return hit.name;
      }
      const legacy = (ct.instructor_name ?? '').trim();
      return legacy || 'Not set';
    },
    [unifiedCalendars],
  );

  const groupedAgendaInstances = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const sorted = [...filteredInstances]
      .filter((i) => i.instance_date >= today)
      .sort(
        (a, b) =>
          a.instance_date.localeCompare(b.instance_date) ||
          a.start_time.localeCompare(b.start_time) ||
          a.class_type_id.localeCompare(b.class_type_id),
      )
      .slice(0, 80);
    const groups: { date: string; items: ClassInstance[] }[] = [];
    for (const inst of sorted) {
      const tail = groups[groups.length - 1];
      if (!tail || tail.date !== inst.instance_date) {
        groups.push({ date: inst.instance_date, items: [inst] });
      } else {
        tail.items.push(inst);
      }
    }
    return groups;
  }, [filteredInstances]);

  /** Instructor id no longer in calendar/practitioner lists (deleted); keep selectable in the dropdown. */
  const orphanInstructorOption = useMemo(() => {
    if (!editingClassTypeId || !showClassTypeForm) return null;
    const ct = classTypes.find((c) => c.id === editingClassTypeId);
    const id = ct?.instructor_id;
    if (!id) return null;
    if (unifiedCalendars.some((c) => c.id === id)) return null;
    if (practitioners.some((p) => p.id === id)) return null;
    return { id, label: ct.instructor_name?.trim() || 'Saved instructor' };
  }, [editingClassTypeId, showClassTypeForm, classTypes, unifiedCalendars, practitioners]);

  /** Legacy rows stored the calendar display name in `instructor_name`; treat that as “no custom label”. */
  const customClassInstructorFromStored = useCallback(
    (ct: ClassType): string => {
      const stored = (ct.instructor_name ?? '').trim();
      if (!stored) return '';
      const cal = unifiedCalendars.find((c) => c.id === ct.instructor_id);
      if (cal && stored === cal.name.trim()) return '';
      const prac = practitioners.find((p) => p.id === ct.instructor_id);
      if (prac && stored === prac.name.trim()) return '';
      return stored;
    },
    [unifiedCalendars, practitioners],
  );

  const buildClassTypePayload = () => {
    const priceRaw = classTypeForm.price_pence.trim();
    const pricePence =
      priceRaw === '' ? null : Math.max(0, Math.round(parseFloat(priceRaw) * 100));
    const calendarId = classTypeForm.instructor_staff_id.trim();
    const custom = classTypeForm.instructor_custom_name.trim();
    const depositRaw = classTypeForm.deposit_pounds.trim();
    const depositPence =
      classTypeForm.payment_requirement === 'deposit' && depositRaw !== ''
        ? Math.max(0, Math.round(parseFloat(depositRaw) * 100))
        : null;

    return {
      name: classTypeForm.name.trim(),
      description: classTypeForm.description.trim() || null,
      duration_minutes: classTypeForm.duration_minutes,
      capacity: classTypeForm.capacity,
      colour: classTypeForm.colour,
      is_active: classTypeForm.is_active,
      payment_requirement: classTypeForm.payment_requirement,
      deposit_amount_pence: depositPence,
      price_pence: pricePence,
      instructor_id: calendarId,
      instructor_name: custom || null,
      max_advance_booking_days: classTypeForm.max_advance_booking_days,
      min_booking_notice_hours: classTypeForm.min_booking_notice_hours,
      cancellation_notice_hours: classTypeForm.cancellation_notice_hours,
      allow_same_day_booking: classTypeForm.allow_same_day_booking,
    };
  };

  const buildTimetableRecurrencePayload = () => {
    let recurrence_end_date: string | null = null;
    let total_occurrences: number | null = null;
    if (timetableForm.end_condition === 'until' && timetableForm.recurrence_end_date.trim() !== '') {
      recurrence_end_date = timetableForm.recurrence_end_date.trim();
    }
    if (timetableForm.end_condition === 'count' && timetableForm.total_occurrences.trim() !== '') {
      const n = parseInt(timetableForm.total_occurrences, 10);
      if (!Number.isNaN(n) && n > 0) total_occurrences = n;
    }
    return {
      day_of_week: timetableForm.day_of_week,
      start_time: timetableForm.start_time,
      interval_weeks: timetableForm.interval_weeks,
      recurrence_type: 'weekly',
      recurrence_end_date,
      total_occurrences,
    };
  };

  const handleSaveClassType = async () => {
    if (!classTypeForm.name.trim()) {
      setClassTypeError('Class name is required.');
      return;
    }
    if (!classTypeForm.instructor_staff_id.trim()) {
      setClassTypeError('Select a calendar for this class.');
      return;
    }
    setClassTypeSaving(true);
    setClassTypeError(null);
    try {
      const payload = buildClassTypePayload();
      const res = editingClassTypeId
        ? await fetch('/api/venue/classes', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: editingClassTypeId, entity_type: 'class_type', ...payload }),
          })
        : await fetch('/api/venue/classes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
      const json = await res.json();
      if (!res.ok) {
        setClassTypeError((json as { error?: string }).error ?? 'Save failed');
        return;
      }
      setShowClassTypeForm(false);
      setEditingClassTypeId(null);
      setClassTypeForm({ ...BLANK_CT });
      setNotice({ kind: 'success', message: editingClassTypeId ? 'Class updated.' : 'Class created.' });
      await fetchData({ silent: true });
    } catch {
      setClassTypeError('Save failed');
    } finally {
      setClassTypeSaving(false);
    }
  };

  const handleEditClassType = (ct: ClassType) => {
    const staffId = ct.instructor_id ?? '';
    const payReq = ct.payment_requirement ?? 'none';
    const depositPounds =
      payReq === 'deposit' && ct.deposit_amount_pence != null
        ? (ct.deposit_amount_pence / 100).toFixed(2)
        : '';
    setClassTypeForm({
      name: ct.name,
      description: (ct.description ?? '').trim(),
      duration_minutes: ct.duration_minutes,
      capacity: ct.capacity,
      price_pence: ct.price_pence != null ? (ct.price_pence / 100).toFixed(2) : '',
      colour: ct.colour ?? '#6366f1',
      is_active: ct.is_active,
      instructor_staff_id: staffId,
      instructor_custom_name: customClassInstructorFromStored(ct),
      payment_requirement: payReq,
      deposit_pounds: depositPounds,
      max_advance_booking_days: ct.max_advance_booking_days ?? 90,
      min_booking_notice_hours: ct.min_booking_notice_hours ?? 1,
      cancellation_notice_hours: ct.cancellation_notice_hours ?? 48,
      allow_same_day_booking: ct.allow_same_day_booking ?? true,
    });
    setEditingClassTypeId(ct.id);
    setClassTypeError(null);
    setShowClassTypeForm(true);
  };

  const requestDeleteClassType = (id: string) => {
    setClassDeleteDialogError(null);
    setClassDeleteDialog({ kind: 'class_type', id });
  };

  const requestDeleteTimetableEntry = (id: string) => {
    setClassDeleteDialogError(null);
    setClassDeleteDialog({ kind: 'timetable', id });
  };

  const requestDeleteInstance = (inst: ClassInstance) => {
    setClassDeleteDialogError(null);
    setClassDeleteDialog({ kind: 'instance', inst });
  };

  const confirmClassDelete = async () => {
    const target = classDeleteDialog;
    if (!target) return;
    setClassDeleteBusy(true);
    setClassDeleteDialogError(null);
    if (target.kind === 'instance') {
      setInstanceDeletingId(target.inst.id);
    }
    try {
      const body =
        target.kind === 'class_type'
          ? { id: target.id, entity_type: 'class_type' as const }
          : target.kind === 'timetable'
            ? { id: target.id, entity_type: 'timetable' as const }
            : { id: target.inst.id, entity_type: 'instance' as const };
      const res = await fetch('/api/venue/classes', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setClassDeleteDialogError(json.error ?? 'Delete failed');
        return;
      }
      setClassDeleteDialog(null);
      if (target.kind === 'instance') {
        setEditingInstance(null);
        removeInstanceFromList(target.inst.id);
        if (classInstanceSheet?.instanceId === target.inst.id) {
          setClassInstanceSheet(null);
        }
        setNotice({ kind: 'success', message: 'Session removed from the calendar.' });
      } else if (target.kind === 'class_type') {
        setNotice({ kind: 'success', message: 'Class type deleted.' });
      } else {
        setNotice({ kind: 'success', message: 'Schedule entry removed.' });
      }
      await fetchData({ silent: true });
    } catch {
      setClassDeleteDialogError('Delete failed');
    } finally {
      setClassDeleteBusy(false);
      setInstanceDeletingId(null);
    }
  };

  const handleSaveTimetableEdit = async () => {
    if (!editingTimetable) return;
    setPatchSaving(true);
    try {
      const recurrence = buildTimetableRecurrencePayload();
      const res = await fetch('/api/venue/classes', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingTimetable.id,
          entity_type: 'timetable',
          ...recurrence,
          is_active: true,
        }),
      });
      if (!res.ok) {
        const json = await res.json();
        setNotice({ kind: 'error', message: (json as { error?: string }).error ?? 'Update failed' });
        return;
      }
      setEditingTimetable(null);
      setNotice({ kind: 'success', message: 'Schedule updated.' });
      await fetchData({ silent: true });
    } catch {
      setNotice({ kind: 'error', message: 'Update failed' });
    } finally {
      setPatchSaving(false);
    }
  };

  const handleSaveInstanceEdit = async () => {
    if (!editingInstance) return;
    setPatchSaving(true);
    try {
      const t = editInstanceForm.time.length === 5 ? `${editInstanceForm.time}:00` : editInstanceForm.time;
      const res = await fetch('/api/venue/classes', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingInstance.id,
          entity_type: 'instance',
          instance_date: editInstanceForm.date,
          start_time: t,
          ...(editInstanceForm.capacity.trim() !== ''
            ? { capacity_override: parseInt(editInstanceForm.capacity, 10) }
            : { capacity_override: null }),
        }),
      });
      if (!res.ok) {
        const json = await res.json();
        setNotice({ kind: 'error', message: (json as { error?: string }).error ?? 'Failed to update session' });
        return;
      }
      setEditingInstance(null);
      setNotice({ kind: 'success', message: 'Session updated.' });
      await fetchData({ silent: true });
      if (classInstanceSheet?.instanceId === editingInstance.id) {
        setClassSheetRefresh((n) => n + 1);
      }
    } catch {
      setNotice({ kind: 'error', message: 'Failed to update session' });
    } finally {
      setPatchSaving(false);
    }
  };

  const openEditTimetable = (e: TimetableEntry) => {
    setEditingTimetable(e);
    const hasEnd = e.recurrence_end_date != null && String(e.recurrence_end_date).trim() !== '';
    const hasCount = e.total_occurrences != null && e.total_occurrences > 0;
    setTimetableForm({
      day_of_week: e.day_of_week,
      start_time: e.start_time.slice(0, 5),
      interval_weeks: e.interval_weeks ?? 1,
      end_condition: hasEnd ? 'until' : hasCount ? 'count' : 'never',
      recurrence_end_date: hasEnd ? String(e.recurrence_end_date).slice(0, 10) : '',
      total_occurrences: hasCount ? String(e.total_occurrences) : '',
    });
  };

  const openEditInstance = (inst: ClassInstance) => {
    setEditingInstance(inst);
    setEditInstanceForm({
      date: inst.instance_date,
      time: inst.start_time.slice(0, 5),
      capacity: inst.capacity_override != null ? String(inst.capacity_override) : '',
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Classes"
        title="Class timetable"
        subtitle="Set up class types, add sessions to the calendar, then manage bookings from your roster."
        actions={
          <>
            {classCommerceEnabled ? (
              <Link
                href="/dashboard/class-timetable/products"
                className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50"
              >
                Class products
              </Link>
            ) : null}
            {isAdmin || linkedPractitionerIds.length > 0 ? (
              <button
                type="button"
                onClick={() => {
                  setEditingClassTypeId(null);
                  setClassTypeForm({ ...BLANK_CT });
                  setClassTypeError(null);
                  setShowClassTypeForm(true);
                }}
                className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-700"
              >
                + Add class type
              </button>
            ) : null}
          </>
        }
      />

      {notice && (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            notice.kind === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-red-200 bg-red-50 text-red-800'
          }`}
        >
          {notice.message}
          <button
            type="button"
            className="ml-3 text-xs text-slate-500 underline"
            onClick={() => setNotice(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      <ClassTimetableStatsRow loading={loading} classTypesLength={classTypes.length} stats={stats} />

      <details className="group overflow-hidden rounded-2xl border border-slate-200/95 bg-white text-slate-900 shadow-sm shadow-slate-900/[0.04]">
        <summary className="flex cursor-pointer list-none items-start justify-between gap-3 border-b border-transparent bg-gradient-to-r from-slate-50/80 to-white px-4 py-4 marker:hidden group-open:border-slate-100/90 sm:px-6 sm:py-5">
          <span className="min-w-0">
            <span className="block text-[10px] font-semibold uppercase tracking-widest text-slate-500">Workflow</span>
            <span className="mt-1 block text-lg font-bold tracking-tight text-slate-900 sm:text-xl">How this page works</span>
            <span className="mt-1 block text-sm font-normal text-slate-600">Expand for workflow guidance.</span>
          </span>
          <svg
            className="mt-1 h-5 w-5 shrink-0 text-slate-400 transition-transform group-open:rotate-180"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
          </svg>
        </summary>
        <SectionCard.Body className="space-y-4 text-sm leading-relaxed text-slate-600">
          <ol className="list-decimal space-y-2 pl-5 marker:font-semibold marker:text-slate-800">
            <li>
              <span className="font-medium text-slate-800">Add Class Type</span>: create the template guests will book,
              including the class name, description, duration, capacity, price/payment rules, booking limits, and the
              calendar column it belongs to. This does not add dates yet; it defines what the class is.
            </li>
            <li>
              <span className="font-medium text-slate-800">Schedule Sessions</span>: open{' '}
              <span className="font-medium text-slate-800">Schedule classes</span> to place that class type onto real
              dates and times. You can add a single session, repeat it weekly, or create a short run every few days.
            </li>
            <li>
              <span className="font-medium text-slate-800">Manage live sessions</span>: use the calendar and upcoming
              agenda to review capacity, edit times, remove sessions, and open the roster for a specific date. These
              scheduled sessions also appear on the{' '}
              <Link href="/dashboard/calendar" className="font-medium text-brand-600 underline hover:text-brand-700">
                dashboard calendar
              </Link>{' '}
              alongside your other bookings.
            </li>
          </ol>
          {!isAdmin && (
            <div className="rounded-lg border border-slate-100 bg-slate-50/90 px-3 py-2.5 text-xs text-slate-600">
              <span className="font-semibold text-slate-700">Staff access:</span>{' '}
              {linkedPractitionerIds.length === 0
                ? 'Your account is not linked to a calendar yet. Ask an admin to assign at least one calendar before managing class sessions.'
                : 'You can view all class types. You can create, edit, or delete types and recurring rules only on calendars you control, and schedule or remove sessions the same way. Cancelling a class with guest notifications remains admin-only.'}
            </div>
          )}
        </SectionCard.Body>
      </details>

      <SectionCard elevated>
        <div className="border-b border-slate-100/90 bg-gradient-to-r from-slate-50/80 to-white px-3 py-2.5 sm:px-4 sm:py-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Catalogue</p>
          <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <h2 className="text-base font-bold tracking-tight text-slate-900">Class types</h2>
            <p className="text-xs leading-4 text-slate-600">Templates guests book against.</p>
          </div>
        </div>
        <SectionCard.Body className="p-0">
          {loading ? (
            <div className="m-4 space-y-2" role="status" aria-label="Loading class types">
              <Skeleton.Line className="h-4 w-48" />
              <Skeleton.Line className="w-full max-w-md" />
            </div>
          ) : classTypes.length === 0 && !showClassTypeForm ? (
            <div className="px-5 py-8">
              <EmptyState
                title="No class types yet"
                description={
                  isAdmin || linkedPractitionerIds.length > 0
                    ? 'Create your first class type to start scheduling sessions and taking bookings.'
                    : 'Your venue has not published any class types yet.'
                }
                action={
                  isAdmin || linkedPractitionerIds.length > 0 ? (
                    <button
                      type="button"
                      className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-700"
                      onClick={() => {
                        setClassTypeForm({ ...BLANK_CT });
                        setClassTypeError(null);
                        setShowClassTypeForm(true);
                      }}
                    >
                      Add class type
                    </button>
                  ) : undefined
                }
              />
            </div>
          ) : classTypes.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-slate-600" role="status">
              Finish your first class type in the form that opened.
            </div>
          ) : (
            <div className="space-y-1.5 p-2 sm:p-3">
              {classTypes.map((ct) => {
                const entries = timetable.filter((e) => e.class_type_id === ct.id && e.is_active);
                const calLabel = resolveCalendarColumnLabel(ct);
                return (
                  <div
                    key={ct.id}
                    className="rounded-lg border border-slate-100 bg-slate-50/40 p-2.5 ring-1 ring-slate-100/70 transition-colors hover:border-slate-200/90 sm:p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-1">
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-black/5"
                            style={{ backgroundColor: ct.colour ?? '#94a3b8' }}
                            aria-hidden
                          />
                          <h3 className="truncate text-sm font-semibold text-slate-900">{ct.name}</h3>
                          {ct.is_active ? (
                            <Pill variant="success" size="sm" dot>
                              Active
                            </Pill>
                          ) : (
                            <Pill variant="neutral" size="sm">
                              Inactive
                            </Pill>
                          )}
                        </div>
                        <p className="flex flex-wrap gap-x-1.5 gap-y-0.5 text-[11px] leading-4 text-slate-600 sm:text-xs">
                          <span>{ct.duration_minutes} min</span>
                          <span className="text-slate-300" aria-hidden>
                            ·
                          </span>
                          <span>{ct.capacity} spots</span>
                          {ct.price_pence != null ? (
                            <>
                              <span className="text-slate-300" aria-hidden>
                                ·
                              </span>
                              <span>{formatPrice(ct.price_pence)}</span>
                            </>
                          ) : null}
                          <span className="text-slate-300" aria-hidden>
                            ·
                          </span>
                          <span>{paymentRuleSummary(ct, formatPrice)}</span>
                          <span className="text-slate-300" aria-hidden>
                            ·
                          </span>
                          <span className="text-slate-500">Column: {calLabel}</span>
                        </p>
                        {ct.description ? (
                          <p className="line-clamp-1 text-[11px] leading-4 text-slate-500 sm:text-xs">
                            {ct.description}
                          </p>
                        ) : null}
                        {entries.length > 0 && (
                          <div className="flex gap-1 overflow-x-auto pt-0.5">
                            {entries.map((e) => (
                              <span
                                key={e.id}
                                className="flex shrink-0 items-center gap-1 rounded-full border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] leading-4 text-slate-600 sm:text-xs"
                              >
                                {DAY_LABELS_FULL[e.day_of_week]} {e.start_time.slice(0, 5)}
                                {(e.interval_weeks ?? 1) > 1 && (
                                  <span className="text-slate-400"> · every {e.interval_weeks} wks</span>
                                )}
                                {e.recurrence_end_date && (
                                  <span className="text-slate-400" title="Recurrence end date">
                                    {' '}
                                    · until {String(e.recurrence_end_date).slice(0, 10)}
                                  </span>
                                )}
                                {e.total_occurrences != null && e.total_occurrences > 0 && (
                                  <span className="text-slate-400"> · max {e.total_occurrences} sessions</span>
                                )}
                                {(isAdmin || staffManagesClassType(ct)) && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => openEditTimetable(e)}
                                      className="text-slate-500 hover:text-brand-600"
                                      aria-label="Edit schedule entry"
                                    >
                                      edit
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => requestDeleteTimetableEntry(e.id)}
                                      className="text-slate-400 hover:text-red-500"
                                      aria-label="Remove schedule entry"
                                    >
                                      ×
                                    </button>
                                  </>
                                )}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      {(isAdmin || staffManagesClassType(ct)) && (
                        <DashboardEntityRowActions
                          onEdit={() => handleEditClassType(ct)}
                          onDelete={() => requestDeleteClassType(ct.id)}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </SectionCard.Body>
      </SectionCard>

      {loading ? (
        <Skeleton.Card className="min-h-[28rem]">
          <div className="grid gap-3 sm:grid-cols-7">
            {Array.from({ length: 7 }).map((_, i) => (
              <Skeleton.Line key={i} className="h-8" />
            ))}
          </div>
          <div className="mt-4 grid grid-cols-7 gap-2">
            {Array.from({ length: 28 }).map((_, i) => (
              <Skeleton.Block key={i} className="aspect-square min-h-[40px]" />
            ))}
          </div>
        </Skeleton.Card>
      ) : classTypes.length === 0 ? (
        !isAdmin && (
          <div className="rounded-xl border border-slate-200 bg-white p-12 text-center">
            <p className="text-slate-500">No class types configured yet.</p>
          </div>
        )
      ) : (
        <div className="space-y-6">
          <ClassTimetableReadOnlyCalendar
            classTypes={classTypes.map((ct) => ({
              id: ct.id,
              name: ct.name,
              colour: ct.colour ?? '#6366f1',
            }))}
            instances={filteredInstances}
            filterClassTypeId={scheduledClassFilterId}
            onFilterClassTypeIdChange={setScheduledClassFilterId}
            isAdmin={isAdmin}
            onEditInstance={
              canOpenScheduleModal
                ? (ro) => {
                    const full = instances.find((i) => i.id === ro.id);
                    if (!full) return;
                    const ct = typeMap.get(full.class_type_id);
                    if (isAdmin || staffManagesClassType(ct)) openEditInstance(full);
                  }
                : undefined
            }
            canEditInstance={(ro) => {
              const full = instances.find((i) => i.id === ro.id);
              if (!full) return false;
              const ct = typeMap.get(full.class_type_id);
              return isAdmin || staffManagesClassType(ct);
            }}
            onOpenSchedule={canOpenScheduleModal ? () => setScheduleModalOpen(true) : undefined}
          />

          <section>
            <SectionCard>
              <SectionCard.Header
                eyebrow="Agenda"
                title="Upcoming sessions"
                description="Soonest first, grouped by date. Select a row to load the roster."
              />
              <SectionCard.Body className="space-y-5">
                {groupedAgendaInstances.length === 0 ? (
                  <p className="text-sm text-slate-500">
                    {scheduledClassFilterId === 'all'
                      ? 'No sessions from today onward.'
                      : `No upcoming sessions for ${typeMap.get(scheduledClassFilterId)?.name ?? 'this class'}.`}{' '}
                    Open <span className="font-medium text-slate-700">Schedule classes</span> above to add dates.
                  </p>
                ) : (
                  groupedAgendaInstances.map((g) => (
                    <div key={g.date}>
                      <p className="mb-2 border-b border-slate-100 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {new Date(`${g.date}T12:00:00`).toLocaleDateString('en-GB', {
                          weekday: 'short',
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </p>
                      <div className="space-y-2">
                        {g.items.map((inst) => {
                          const ct = typeMap.get(inst.class_type_id);
                          const cap = inst.capacity_override ?? ct?.capacity ?? 0;
                          const booked = inst.booked_spots ?? 0;
                          return (
                            <div
                              key={inst.id}
                              className={`flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border px-4 py-3 text-left text-sm shadow-sm transition-colors ${
                                classInstanceSheet?.instanceId === inst.id
                                  ? 'border-brand-200 bg-brand-50/40 ring-1 ring-brand-200'
                                  : 'border-slate-100 bg-white hover:border-brand-200/80 hover:bg-slate-50/80'
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  if (classInstanceSheet?.instanceId === inst.id) {
                                    setClassInstanceSheet(null);
                                  } else {
                                    setClassInstanceSheet({
                                      instanceId: inst.id,
                                      block: buildAgendaClassBlock(inst, ct),
                                    });
                                  }
                                }}
                                className="flex min-w-0 flex-1 items-center gap-3 text-left"
                              >
                                <span
                                  className="h-10 w-1.5 shrink-0 rounded-full"
                                  style={{ backgroundColor: ct?.colour ?? '#4E6B78' }}
                                />
                                <span className="w-14 shrink-0 text-xs font-bold tabular-nums text-slate-900 sm:text-sm">
                                  {inst.start_time.slice(0, 5)}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-sm font-semibold text-slate-900">{ct?.name}</span>
                                  <span className="block truncate text-xs text-slate-500">
                                    {booked}/{cap} booked
                                  </span>
                                </span>
                                {inst.is_cancelled ? (
                                  <Pill variant="danger" size="sm">
                                    Cancelled
                                  </Pill>
                                ) : null}
                              </button>
                              {(isAdmin || staffManagesClassType(ct)) && (
                                <span className="flex gap-3">
                                  <button
                                    type="button"
                                    onClick={() => openEditInstance(inst)}
                                    className="text-xs font-semibold text-brand-600 hover:text-brand-800"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => requestDeleteInstance(inst)}
                                    disabled={instanceDeletingId === inst.id}
                                    className="text-xs font-semibold text-red-600 hover:text-red-800 disabled:opacity-50"
                                  >
                                    {instanceDeletingId === inst.id ? 'Removing…' : 'Remove'}
                                  </button>
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))
                )}
              </SectionCard.Body>
            </SectionCard>
          </section>
        </div>
      )}

      {scheduleModalOpen &&
        (isAdmin ? classTypes.length > 0 : scheduleModalClassTypes.length > 0) && (
        <ClassScheduleModal
          open={scheduleModalOpen}
          onClose={() => setScheduleModalOpen(false)}
          classTypes={scheduleModalClassTypes.map((ct) => ({
            id: ct.id,
            name: ct.name,
            colour: ct.colour ?? '#6366f1',
            capacity: ct.capacity,
          }))}
          instances={instances}
          onRefresh={refreshClassData}
          onInstanceRemoved={removeInstanceFromList}
          setNotice={setNotice}
          openEditInstance={openEditInstance}
        />
      )}

      {showClassTypeForm && (isAdmin || linkedPractitionerIds.length > 0) && (
        <div
          className="fixed inset-0 z-[55] flex items-start justify-center overflow-y-auto bg-black/50 p-4 py-8 sm:items-center sm:py-10"
          onClick={(e) => {
            if (e.target !== e.currentTarget || classTypeSaving) return;
            setShowClassTypeForm(false);
            setEditingClassTypeId(null);
            setClassTypeError(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="class-type-form-title"
            className="my-auto w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4 sm:px-6">
              <h2 id="class-type-form-title" className="text-lg font-semibold text-slate-900">
                {editingClassTypeId ? 'Edit class type' : 'New class type'}
              </h2>
              <button
                type="button"
                className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
                aria-label="Close"
                disabled={classTypeSaving}
                onClick={() => {
                  setShowClassTypeForm(false);
                  setEditingClassTypeId(null);
                  setClassTypeError(null);
                }}
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleSaveClassType();
              }}
              className="max-h-[min(78vh,calc(100vh-5rem))] overflow-y-auto px-5 pb-5 pt-1 sm:px-6"
            >
              <div className="space-y-6 pb-2">
                <section className="space-y-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Basics</h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <label className="mb-1 block text-xs font-medium text-slate-600">Name *</label>
                      <input
                        type="text"
                        value={classTypeForm.name}
                        onChange={(e) => setClassTypeForm((f) => ({ ...f, name: e.target.value }))}
                        placeholder="e.g. Beginner session, Open studio"
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="mb-1 block text-xs font-medium text-slate-600">Description</label>
                      <textarea
                        value={classTypeForm.description}
                        onChange={(e) => setClassTypeForm((f) => ({ ...f, description: e.target.value }))}
                        rows={3}
                        placeholder="Shown to guests on the booking page."
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-600">Colour</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={classTypeForm.colour}
                          onChange={(e) => setClassTypeForm((f) => ({ ...f, colour: e.target.value }))}
                          className="h-9 w-12 cursor-pointer rounded border border-slate-200 p-0.5"
                        />
                        <span className="text-xs text-slate-500">{classTypeForm.colour}</span>
                      </div>
                    </div>
                    <div className="flex items-end pb-1">
                      <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                        <input
                          id="ct-active-modal"
                          type="checkbox"
                          checked={classTypeForm.is_active}
                          onChange={(e) => setClassTypeForm((f) => ({ ...f, is_active: e.target.checked }))}
                          className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                        />
                        <span>Active (visible to guests)</span>
                      </label>
                    </div>
                  </div>
                </section>

                <section className="space-y-3 border-t border-slate-100 pt-5">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Session defaults</h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-600">Duration (minutes)</label>
                      <NumericInput
                        min={5}
                        max={480}
                        value={classTypeForm.duration_minutes}
                        onChange={(v) => setClassTypeForm((f) => ({ ...f, duration_minutes: v }))}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-600">Capacity (spots)</label>
                      <NumericInput
                        min={1}
                        value={classTypeForm.capacity}
                        onChange={(v) => setClassTypeForm((f) => ({ ...f, capacity: v }))}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="mb-1 block text-xs font-medium text-slate-600">Calendar column *</label>
                      <p className="mb-2 text-xs text-slate-500">
                        Pick the team calendar column this class occupies in the schedule.
                      </p>
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                        <select
                          value={classTypeForm.instructor_staff_id}
                          onChange={(e) =>
                            setClassTypeForm((f) => ({ ...f, instructor_staff_id: e.target.value }))
                          }
                          className="w-full max-w-md rounded-lg border border-slate-200 px-3 py-2 text-sm"
                          required
                        >
                          <option value="" disabled>
                            Choose a calendar…
                          </option>
                          {unifiedCalendars.length > 0 && (
                            <optgroup label="Calendar columns">
                              {unifiedCalendars.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name}
                                </option>
                              ))}
                            </optgroup>
                          )}
                          {orphanInstructorOption && (
                            <option value={orphanInstructorOption.id}>{orphanInstructorOption.label}</option>
                          )}
                        </select>
                        <div className="min-w-0 flex-1">
                          <label className="mb-1 block text-xs font-medium text-slate-600">
                            Instructor label (optional)
                          </label>
                          <input
                            type="text"
                            value={classTypeForm.instructor_custom_name}
                            onChange={(e) =>
                              setClassTypeForm((f) => ({ ...f, instructor_custom_name: e.target.value }))
                            }
                            placeholder="Shown to guests instead of the calendar name"
                            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                          />
                        </div>
                      </div>
                      {isAdmin && (
                        <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50/90 p-3">
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
                                className="inline-flex w-full max-w-xs items-center justify-center rounded-lg border border-brand-200/90 bg-white px-3 py-2 text-xs font-semibold text-brand-700 shadow-sm transition hover:border-brand-400 hover:bg-brand-50"
                              >
                                Add calendar column
                              </button>
                              <p className="mt-2 text-xs text-slate-500">
                                Need services or staff links? Manage columns in{' '}
                                <Link
                                  href="/dashboard/calendar-availability?tab=calendars"
                                  className="font-medium text-brand-700 underline hover:text-brand-800"
                                >
                                  Calendar availability
                                </Link>
                                .
                              </p>
                            </>
                          ) : (
                            <p className="text-xs text-amber-950">
                              <CalendarLimitMessage
                                entitlement={calendarEntitlement}
                                linkClassName="font-medium text-brand-700 underline hover:text-brand-800"
                              />
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </section>

                <section className="space-y-3 border-t border-slate-100 pt-5">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Guest booking rules</h3>
                  <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-600">Max advance (days)</label>
                        <NumericInput
                          min={1}
                          max={365}
                          value={classTypeForm.max_advance_booking_days}
                          onChange={(v) =>
                            setClassTypeForm((f) => ({
                              ...f,
                              max_advance_booking_days: v,
                            }))
                          }
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-600">Min notice (hours)</label>
                        <NumericInput
                          min={0}
                          max={168}
                          value={classTypeForm.min_booking_notice_hours}
                          onChange={(v) =>
                            setClassTypeForm((f) => ({
                              ...f,
                              min_booking_notice_hours: v,
                            }))
                          }
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-600">
                          Cancellation notice (hours)
                        </label>
                        <NumericInput
                          min={0}
                          max={168}
                          value={classTypeForm.cancellation_notice_hours}
                          onChange={(v) =>
                            setClassTypeForm((f) => ({
                              ...f,
                              cancellation_notice_hours: v,
                            }))
                          }
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        />
                      </div>
                      <div className="flex items-end pb-1">
                        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            checked={classTypeForm.allow_same_day_booking}
                            onChange={(e) =>
                              setClassTypeForm((f) => ({ ...f, allow_same_day_booking: e.target.checked }))
                            }
                            className="h-4 w-4 rounded border-slate-300"
                          />
                          Allow same-day bookings
                        </label>
                      </div>
                    </div>
                  </div>
                </section>

                <section className="space-y-3 border-t border-slate-100 pt-5">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Price & online payment</h3>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">
                      Price ({sym}) <span className="font-normal text-slate-400">optional</span>
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      value={classTypeForm.price_pence}
                      onChange={(e) => setClassTypeForm((f) => ({ ...f, price_pence: e.target.value }))}
                      placeholder="0.00"
                      className="w-full max-w-xs rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-xs font-medium text-slate-600">Online payment (Stripe)</label>
                    <div className="space-y-2">
                      <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-700">
                        <input
                          type="radio"
                          name="payment_requirement_modal"
                          className="mt-0.5"
                          checked={classTypeForm.payment_requirement === 'none'}
                          onChange={() =>
                            setClassTypeForm((f) => ({ ...f, payment_requirement: 'none', deposit_pounds: '' }))
                          }
                        />
                        <span>None: pay at venue or free class</span>
                      </label>
                      <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-700">
                        <input
                          type="radio"
                          name="payment_requirement_modal"
                          className="mt-0.5"
                          checked={classTypeForm.payment_requirement === 'deposit'}
                          onChange={() => setClassTypeForm((f) => ({ ...f, payment_requirement: 'deposit' }))}
                        />
                        <span>Deposit per person (partial payment online)</span>
                      </label>
                      <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-700">
                        <input
                          type="radio"
                          name="payment_requirement_modal"
                          className="mt-0.5"
                          checked={classTypeForm.payment_requirement === 'full_payment'}
                          onChange={() =>
                            setClassTypeForm((f) => ({
                              ...f,
                              payment_requirement: 'full_payment',
                              deposit_pounds: '',
                            }))
                          }
                        />
                        <span>Full payment online (per person)</span>
                      </label>
                    </div>
                    {classTypeForm.payment_requirement === 'deposit' && (
                      <div className="mt-3 max-w-xs">
                        <label className="mb-1 block text-xs font-medium text-slate-600">
                          Deposit amount ({sym}) *
                        </label>
                        <input
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                          value={classTypeForm.deposit_pounds}
                          onChange={(e) => setClassTypeForm((f) => ({ ...f, deposit_pounds: e.target.value }))}
                          placeholder="e.g. 5.00"
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                        />
                      </div>
                    )}
                    <p className="mt-2 text-xs text-slate-500">
                      Deposit and full payment require a price per person and a connected Stripe account.
                    </p>
                    <StripePaymentWarning
                      stripeConnected={stripeConnected}
                      requiresOnlinePayment={
                        classTypeForm.payment_requirement === 'deposit' ||
                        classTypeForm.payment_requirement === 'full_payment'
                      }
                    />
                  </div>
                </section>
              </div>

              {classTypeError && (
                <p className="mt-3 text-sm text-red-600" role="alert">
                  {classTypeError}
                </p>
              )}

              <div className="sticky bottom-0 mt-4 flex flex-wrap gap-2 border-t border-slate-100 bg-white/95 py-4 backdrop-blur-sm">
                <button
                  type="submit"
                  disabled={classTypeSaving}
                  className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
                >
                  {classTypeSaving ? 'Saving…' : 'Save class type'}
                </button>
                <button
                  type="button"
                  disabled={classTypeSaving}
                  onClick={() => {
                    setShowClassTypeForm(false);
                    setEditingClassTypeId(null);
                    setClassTypeError(null);
                  }}
                  className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showAddCalendarModal && isAdmin && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          onClick={() => {
            if (addCalendarSubmitting) return;
            setShowAddCalendarModal(false);
            setAddCalendarModalError(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-calendar-modal-title"
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 pb-[max(1.5rem,env(safe-area-inset-bottom,0px))] shadow-xl sm:pb-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="add-calendar-modal-title" className="mb-1 text-lg font-semibold text-slate-900">
              Add calendar
            </h2>
            <p className="mb-4 text-sm text-slate-500">
              Same defaults as Calendar availability: weekly hours are set automatically; you can edit them in
              Availability later.
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
              placeholder="e.g. Studio A, Front desk"
              disabled={addCalendarSubmitting}
              className="mb-4 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 disabled:opacity-60"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void submitInlineNewCalendar();
                }
              }}
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void submitInlineNewCalendar()}
                disabled={addCalendarSubmitting}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {addCalendarSubmitting ? 'Creating…' : 'Create and select'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowAddCalendarModal(false);
                  setAddCalendarModalError(null);
                }}
                disabled={addCalendarSubmitting}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {editingTimetable && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 pb-[max(1.5rem,env(safe-area-inset-bottom,0px))] shadow-xl sm:pb-6">
            <h3 className="mb-4 text-lg font-semibold text-slate-900">Edit weekly rule</h3>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Day</label>
                <select
                  value={timetableForm.day_of_week}
                  onChange={(e) => setTimetableForm((f) => ({ ...f, day_of_week: parseInt(e.target.value) }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                >
                  {DAY_LABELS_FULL.map((label, i) => (
                    <option key={i} value={i}>{label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Start time</label>
                <input
                  type="time"
                  value={timetableForm.start_time}
                  onChange={(e) => setTimetableForm((f) => ({ ...f, start_time: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Every N weeks</label>
                <select
                  value={timetableForm.interval_weeks}
                  onChange={(e) =>
                    setTimetableForm((f) => ({ ...f, interval_weeks: parseInt(e.target.value, 10) || 1 }))
                  }
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                >
                  <option value={1}>Weekly</option>
                  <option value={2}>Every 2 weeks</option>
                  <option value={3}>Every 3 weeks</option>
                  <option value={4}>Every 4 weeks</option>
                </select>
              </div>
              <div>
                <label className="mb-2 block text-xs font-medium text-slate-600">End recurrence (optional)</label>
                <div className="space-y-2 text-sm text-slate-700">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="edit-tt-end"
                      checked={timetableForm.end_condition === 'never'}
                      onChange={() =>
                        setTimetableForm((f) => ({
                          ...f,
                          end_condition: 'never',
                          recurrence_end_date: '',
                          total_occurrences: '',
                        }))
                      }
                    />
                    Ongoing (no end)
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="edit-tt-end"
                      checked={timetableForm.end_condition === 'until'}
                      onChange={() => setTimetableForm((f) => ({ ...f, end_condition: 'until' }))}
                    />
                    Until a fixed date
                  </label>
                  {timetableForm.end_condition === 'until' && (
                    <input
                      type="date"
                      value={timetableForm.recurrence_end_date}
                      onChange={(e) =>
                        setTimetableForm((f) => ({ ...f, recurrence_end_date: e.target.value }))
                      }
                      className="ml-6 w-full max-w-xs rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    />
                  )}
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="edit-tt-end"
                      checked={timetableForm.end_condition === 'count'}
                      onChange={() => setTimetableForm((f) => ({ ...f, end_condition: 'count' }))}
                    />
                    After N generated sessions
                  </label>
                  {timetableForm.end_condition === 'count' && (
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      placeholder="e.g. 12"
                      value={timetableForm.total_occurrences}
                      onChange={(e) =>
                        setTimetableForm((f) => ({ ...f, total_occurrences: e.target.value.replace(/[^0-9]/g, '') }))
                      }
                      className="ml-6 w-full max-w-xs rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    />
                  )}
                </div>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingTimetable(null)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleSaveTimetableEdit()}
                disabled={patchSaving}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {patchSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editingInstance && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 pb-[max(1.5rem,env(safe-area-inset-bottom,0px))] shadow-xl sm:pb-6">
            <h3 className="text-lg font-semibold text-slate-900">Edit session</h3>
            {typeMap.get(editingInstance.class_type_id)?.name ? (
              <p className="mt-1 text-base font-medium text-slate-800">
                {typeMap.get(editingInstance.class_type_id)?.name}
              </p>
            ) : null}
            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Date</label>
                <input
                  type="date"
                  value={editInstanceForm.date}
                  onChange={(e) => setEditInstanceForm((f) => ({ ...f, date: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Start time</label>
                <input
                  type="time"
                  value={editInstanceForm.time}
                  onChange={(e) => setEditInstanceForm((f) => ({ ...f, time: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Capacity override (optional)</label>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  value={editInstanceForm.capacity}
                  onChange={(e) => setEditInstanceForm((f) => ({ ...f, capacity: e.target.value.replace(/[^0-9]/g, '') }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
              {editingInstance &&
                (isAdmin ||
                  staffManagesClassType(typeMap.get(editingInstance.class_type_id))) && (
                <button
                  type="button"
                  onClick={() => requestDeleteInstance(editingInstance)}
                  disabled={instanceDeletingId === editingInstance.id || patchSaving}
                  className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-800 hover:bg-red-100 disabled:opacity-50"
                >
                  {instanceDeletingId === editingInstance.id ? 'Removing…' : 'Remove from calendar'}
                </button>
              )}
              <div className="ml-auto flex gap-2">
                <button
                  type="button"
                  onClick={() => setEditingInstance(null)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleSaveInstanceEdit()}
                  disabled={patchSaving}
                  className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                >
                  {patchSaving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ClassInstanceDetailSheet
        selection={classInstanceSheet}
        onClose={() => setClassInstanceSheet(null)}
        currency={currency}
        timetableContext
        isAdmin={isAdmin}
        refreshSignal={classSheetRefresh}
        onSessionMutated={() => void fetchData({ silent: true })}
        onNotice={(n) => setNotice(n)}
      />

      {classDeleteDialog && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/25 p-4 backdrop-blur-[2px]"
          onClick={() => {
            if (!classDeleteBusy) setClassDeleteDialog(null);
          }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="class-delete-title"
            aria-describedby="class-delete-desc"
            className="w-full max-w-md rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xl shadow-slate-900/15 ring-1 ring-slate-100"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="class-delete-title" className="text-base font-semibold text-slate-900">
              {classDeleteDialog.kind === 'class_type'
                ? 'Delete this class type?'
                : classDeleteDialog.kind === 'timetable'
                  ? 'Remove this schedule rule?'
                  : 'Remove this session?'}
            </h3>
            <p id="class-delete-desc" className="mt-2 text-sm text-slate-600">
              {classDeleteDialog.kind === 'class_type' ? (
                <>
                  <span className="font-medium text-slate-800">
                    {classTypes.find((c) => c.id === classDeleteDialog.id)?.name ?? 'This class'}
                  </span>{' '}
                  will be removed. Existing dated sessions stay on the calendar; new ones will not be generated from
                  this type. This cannot be undone.
                </>
              ) : classDeleteDialog.kind === 'timetable' ? (
                <>
                  Existing dated sessions stay on the calendar; only future generation from this weekly rule stops.
                  Delete individual sessions from the list if you still need to clear dates.
                </>
              ) : (
                <>
                  Remove{' '}
                  <span className="font-medium text-slate-800">
                    {typeMap.get(classDeleteDialog.inst.class_type_id)?.name ?? 'Class'}
                  </span>{' '}
                  on {classDeleteDialog.inst.instance_date} at {classDeleteDialog.inst.start_time.slice(0, 5)}?
                  {(classDeleteDialog.inst.booked_spots ?? 0) > 0 ? (
                    <>
                      {' '}
                      {classDeleteDialog.inst.booked_spots} booking(s) will stay on file but will no longer be linked to
                      this class time.
                    </>
                  ) : null}
                </>
              )}
            </p>
            {classDeleteDialogError ? (
              <div
                role="alert"
                className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
              >
                {classDeleteDialogError}
              </div>
            ) : null}
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setClassDeleteDialog(null)}
                disabled={classDeleteBusy}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmClassDelete()}
                disabled={classDeleteBusy}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-700 disabled:opacity-50"
              >
                {classDeleteBusy
                  ? 'Deleting…'
                  : classDeleteDialog.kind === 'instance'
                    ? 'Remove session'
                    : classDeleteDialog.kind === 'timetable'
                      ? 'Remove rule'
                      : 'Delete class type'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
