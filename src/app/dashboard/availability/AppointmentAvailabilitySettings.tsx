'use client';

import { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { defaultNewUnifiedCalendarWorkingHours } from '@/lib/availability/practitioner-defaults';
import type { TimeRange, WorkingHours } from '@/types/booking-models';
import { StaffLeaveCalendarPanel } from '@/app/dashboard/availability/StaffLeaveCalendarPanel';
import { BookableCalendarsPanel } from '@/app/dashboard/availability/BookableCalendarsPanel';
import { WorkingHoursControl } from '@/components/scheduling/WorkingHoursControl';
import { useCalendarEntitlement } from '@/hooks/use-calendar-entitlement';
import { AppointmentAvailabilityTabPanelSkeleton } from '@/components/ui/dashboard/DashboardSkeletons';

// ─── Types ──────────────────────────────────────────────────────────────────
interface Practitioner {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  staff_id: string | null;
  /** Unified scheduling: staff accounts assigned to manage this calendar (junction). */
  staff_ids?: string[];
  slug?: string | null;
  /** unified_calendars.calendar_type — resource rows are excluded from appointment calendar UI */
  calendar_type?: string | null;
  working_hours: Record<string, Array<{ start: string; end: string }>>;
  break_times: Array<{ start: string; end: string }>;
  break_times_by_day?: WorkingHours | null;
  days_off: string[];
  is_active: boolean;
  sort_order: number;
}

interface ClassTypeRow {
  id: string;
  name: string;
  instructor_id: string | null;
  /** Resolved unified team calendar id (same as instructor_id when already stored as unified). From GET /api/venue/classes. */
  instructor_calendar_id?: string | null;
}

/** Whether this class type is assigned to the given team calendar column (handles legacy instructor ids). */
function classTypeUsesCalendarColumn(ct: ClassTypeRow, calendarColumnId: string): boolean {
  const col = ct.instructor_calendar_id ?? ct.instructor_id;
  return col === calendarColumnId;
}

/** Compare id lists regardless of order (checkbox sets). */
function idsEqualAsSets(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

interface ResourceRow {
  id: string;
  name: string;
  display_on_calendar_id: string | null;
}

interface ExperienceEventRow {
  id: string;
  name: string;
  /** Staff calendar column (`unified_calendars.id`) when the event is placed on the team grid; null = events strip / unassigned. */
  calendar_id: string | null;
  is_active: boolean;
  /** ISO date — each row is one occurrence; recurring series may share a name across rows. */
  event_date: string;
}

interface Service {
  id: string;
  name: string;
}

interface PractitionerServiceLink {
  practitioner_id: string;
  service_id: string;
}

type Tab = 'team' | 'hours' | 'breaks' | 'daysoff';

/** `?tab=` on /dashboard/calendar-availability — "availability" maps to the Hours tab (weekly calendar hours). */
function parseTabQueryParam(raw: string | null): Tab | null {
  if (!raw) return null;
  const r = raw.trim().toLowerCase();
  if (r === 'hours' || r === 'availability') return 'hours';
  if (r === 'team' || r === 'calendars') return 'team';
  if (r === 'breaks') return 'breaks';
  if (
    r === 'daysoff' ||
    r === 'time-off' ||
    r === 'timeoff' ||
    r === 'closures' ||
    r === 'unavailability'
  ) {
    return 'daysoff';
  }
  return null;
}

const ALL_TABS: Array<{ key: Tab; label: string }> = [
  { key: 'team', label: 'Calendars' },
  { key: 'hours', label: 'Availability' },
  { key: 'breaks', label: 'Breaks' },
  { key: 'daysoff', label: 'Closures' },
];

const DAY_LABELS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAY_KEYS = ['1', '2', '3', '4', '5', '6', '0'];

function defaultWorkingHours(): Record<string, Array<{ start: string; end: string }>> {
  return defaultNewUnifiedCalendarWorkingHours();
}

function staffIdsForPractitioner(p: Practitioner): string[] {
  if (p.staff_ids && p.staff_ids.length > 0) return p.staff_ids;
  return p.staff_id ? [p.staff_id] : [];
}

/** Display name for a team calendar column (for allocation warnings). */
function calendarColumnLabel(calendars: Practitioner[], calendarId: string): string {
  return calendars.find((p) => p.id === calendarId)?.name ?? 'another';
}

function canEditBreaksFor(p: Practitioner | null, isAdmin: boolean, staffId: string | null): boolean {
  if (!p) return false;
  if (isAdmin) return true;
  return staffId != null && staffIdsForPractitioner(p).includes(staffId);
}

function canEditWorkingHoursFor(p: Practitioner | null, isAdmin: boolean, staffId: string | null): boolean {
  return canEditBreaksFor(p, isAdmin, staffId);
}

// ─── Component ──────────────────────────────────────────────────────────────
export function AppointmentAvailabilitySettings({
  isAdmin,
  currentStaffId,
}: {
  isAdmin: boolean;
  currentStaffId: string | null;
}) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(() => {
    const fromUrl = parseTabQueryParam(searchParams.get('tab'));
    if (fromUrl) {
      if (fromUrl === 'team' && !isAdmin) return 'hours';
      return fromUrl;
    }
    return isAdmin ? 'team' : 'hours';
  });

  useEffect(() => {
    const fromUrl = parseTabQueryParam(searchParams.get('tab'));
    if (!fromUrl) return;
    if (fromUrl === 'team' && !isAdmin) {
      setTab('hours');
      return;
    }
    setTab(fromUrl);
  }, [searchParams, isAdmin]);
  const [practitioners, setPractitioners] = useState<Practitioner[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [pLinks, setPLinks] = useState<PractitionerServiceLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Add/edit practitioner state
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formActive, setFormActive] = useState(true);
  const [formServiceIds, setFormServiceIds] = useState<string[]>([]);
  const [formClassIds, setFormClassIds] = useState<string[]>([]);
  const [formResourceIds, setFormResourceIds] = useState<string[]>([]);
  /** `experience_events.id` rows to show on this calendar column (`calendar_id`). */
  const [formEventIds, setFormEventIds] = useState<string[]>([]);
  /**
   * Snapshot of class/resource/event checkbox ids when the modal opened. If the user only changes
   * services (or name/active), we skip class/resource/event PATCHes entirely so stale server state
   * cannot trigger false-positive time-window validation (e.g. experience-events PATCH).
   */
  const [snapshotClassIds, setSnapshotClassIds] = useState<string[]>([]);
  const [snapshotResourceIds, setSnapshotResourceIds] = useState<string[]>([]);
  const [snapshotEventIds, setSnapshotEventIds] = useState<string[]>([]);
  const [classTypes, setClassTypes] = useState<ClassTypeRow[]>([]);
  const [resourceRows, setResourceRows] = useState<ResourceRow[]>([]);
  const [experienceEvents, setExperienceEvents] = useState<ExperienceEventRow[]>([]);
  /** Team calendar id → conflict messages (resource + class/event on same column, overlapping resources, etc.). */
  const [calendarColumnAlerts, setCalendarColumnAlerts] = useState<Record<string, string[]>>({});
  const { entitlement, refresh: refreshCalendarEntitlement } = useCalendarEntitlement(isAdmin);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  /** Validation / API errors for the Add/Edit calendar modal only (not the page-level banner). */
  const [calendarModalError, setCalendarModalError] = useState<string | null>(null);

  // Selected practitioner for hours / breaks tabs
  const [selectedPractitionerId, setSelectedPractitionerId] = useState<string>('');

  const visibleTabs = useMemo(() => {
    if (isAdmin) return ALL_TABS;
    return ALL_TABS.filter((t) => t.key !== 'team');
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin && tab === 'team') setTab('hours');
  }, [isAdmin, tab]);

  /** Host appointment columns only (excludes resource-type unified rows). */
  const appointmentCalendars = useMemo(
    () =>
      practitioners
        .filter((p) => (p.calendar_type ?? 'practitioner') !== 'resource')
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    [practitioners],
  );

  /**
   * Class types, resources, and ticketed events may only sit on one team calendar at a time.
   * If already assigned elsewhere, we warn before moving them to the calendar being edited.
   */
  const confirmReassignSingleCalendarEntity = useCallback(
    (entityName: string, otherCalendarId: string | null | undefined) => {
      if (!otherCalendarId) return true;
      const otherName = calendarColumnLabel(appointmentCalendars, otherCalendarId);
      const targetLabel = editingId
        ? calendarColumnLabel(appointmentCalendars, editingId)
        : formName.trim() || 'this new calendar';
      return window.confirm(
        `"${entityName}" already allocated to ${otherName} calendar. Move it to ${targetLabel} instead?`,
      );
    },
    [appointmentCalendars, editingId, formName],
  );

  const fetchAssociationData = useCallback(async (): Promise<{
    classTypes: ClassTypeRow[];
    resourceRows: ResourceRow[];
    experienceEvents: ExperienceEventRow[];
  } | null> => {
    try {
      const [cRes, rRes, eRes] = await Promise.all([
        fetch('/api/venue/classes'),
        fetch('/api/venue/resources'),
        fetch('/api/venue/experience-events'),
      ]);
      let nextClassTypes: ClassTypeRow[] = [];
      if (cRes.ok) {
        const d = (await cRes.json()) as {
          class_types?: Array<{
            id: string;
            name: string;
            instructor_id?: string | null;
            instructor_calendar_id?: string | null;
          }>;
        };
        nextClassTypes = (d.class_types ?? []).map((x) => ({
          id: x.id,
          name: x.name,
          instructor_id: x.instructor_id ?? null,
          instructor_calendar_id: x.instructor_calendar_id ?? null,
        }));
        setClassTypes(nextClassTypes);
      } else {
        setClassTypes([]);
      }
      let nextResources: ResourceRow[] = [];
      if (rRes.ok) {
        const d = (await rRes.json()) as {
          resources?: Array<{ id: string; name: string; display_on_calendar_id?: string | null }>;
        };
        nextResources = (d.resources ?? []).map((x) => ({
          id: x.id,
          name: x.name,
          display_on_calendar_id: x.display_on_calendar_id ?? null,
        }));
        setResourceRows(nextResources);
      } else {
        setResourceRows([]);
      }
      let nextEvents: ExperienceEventRow[] = [];
      if (eRes.ok) {
        const d = (await eRes.json()) as {
          events?: Array<{
            id: string;
            name: string;
            calendar_id?: string | null;
            is_active?: boolean;
            event_date?: string;
          }>;
        };
        nextEvents = (d.events ?? []).map((x) => ({
          id: x.id,
          name: x.name,
          calendar_id: x.calendar_id ?? null,
          is_active: x.is_active !== false,
          event_date: typeof x.event_date === 'string' ? x.event_date : '',
        }));
        setExperienceEvents(nextEvents);
      } else {
        setExperienceEvents([]);
      }

      const confRes = await fetch('/api/venue/calendar-column-conflicts');
      if (confRes.ok) {
        const confData = (await confRes.json()) as {
          conflicts?: Array<{ calendar_id: string; messages: string[] }>;
        };
        const next: Record<string, string[]> = {};
        for (const row of confData.conflicts ?? []) {
          next[row.calendar_id] = row.messages;
        }
        setCalendarColumnAlerts(next);
      } else {
        setCalendarColumnAlerts({});
      }

      return { classTypes: nextClassTypes, resourceRows: nextResources, experienceEvents: nextEvents };
    } catch {
      return null;
    }
  }, []);

  const fetchData = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    if (!silent) {
      setLoading(true);
    }
    setError(null);
    try {
      if (silent) {
        const svcRes = await fetch('/api/venue/appointment-services');
        if (!svcRes.ok) {
          setError('Failed to refresh service links.');
          return;
        }
        const svcData = await svcRes.json();
        setServices(svcData.services ?? []);
        setPLinks(svcData.practitioner_services ?? []);
        if (isAdmin) await fetchAssociationData();
        return;
      }

      const [pracRes, svcRes] = await Promise.all([
        fetch('/api/venue/practitioners?roster=1'),
        fetch('/api/venue/appointment-services'),
        isAdmin ? fetchAssociationData() : Promise.resolve(null),
      ]);
      if (!pracRes.ok || !svcRes.ok) {
        setError('Failed to load data. Please refresh the page.');
        return;
      }
      const [pracData, svcData] = await Promise.all([pracRes.json(), svcRes.json()]);
      const pracs = pracData.practitioners ?? [];
      setPractitioners(pracs);
      setServices(svcData.services ?? []);
      setPLinks(svcData.practitioner_services ?? []);
      setSelectedPractitionerId((prev) => {
        const pool = (pracs as Practitioner[]).filter(
          (p) => (p.calendar_type ?? 'practitioner') !== 'resource',
        );
        const own = currentStaffId
          ? pool.find((p) => staffIdsForPractitioner(p).includes(currentStaffId))
          : undefined;
        if (prev && pool.some((p) => p.id === prev)) return prev;
        return own?.id ?? pool[0]?.id ?? '';
      });
    } catch {
      if (!silent) {
        setError('Failed to load data. Please check your connection.');
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
   
  }, [isAdmin, currentStaffId, fetchAssociationData]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  /** Keep `sort_order` in sync after drag-reorder PATCH — avoids full fetchData() and loading spinner. */
  const applyCalendarReorder = useCallback((orderedIds: string[]) => {
    setPractitioners((prev) =>
      prev.map((p) => {
        const idx = orderedIds.indexOf(p.id);
        if (idx === -1) return p;
        return { ...p, sort_order: idx };
      }),
    );
  }, []);

  const selectedPrac = useMemo(
    () => appointmentCalendars.find((p) => p.id === selectedPractitionerId) ?? null,
    [appointmentCalendars, selectedPractitionerId],
  );

  /** Host appointment columns (excludes resource-type rows) for availability / breaks / leave. */
  const practitionersForScheduleTabs = appointmentCalendars;

  function flash(msg: string) {
    setSuccess(msg);
    setTimeout(() => setSuccess(null), 3000);
  }

  // ─── Team Tab ───────────────────────────────────────────────────────
  const openAdd = useCallback(() => {
    if (!isAdmin) return;
    if (entitlement && !entitlement.unlimited && entitlement.at_calendar_limit) {
      setShowUpgradeModal(true);
      return;
    }
    setEditingId(null);
    setFormName('');
    setFormActive(true);
    setFormServiceIds([]);
    setFormClassIds([]);
    setFormResourceIds([]);
    setFormEventIds([]);
    setSnapshotClassIds([]);
    setSnapshotResourceIds([]);
    setSnapshotEventIds([]);
    setError(null);
    setCalendarModalError(null);
    setShowForm(true);
  }, [isAdmin, entitlement]);

  const openedAddCalendarFromQuery = useRef(false);

  useEffect(() => {
    if (loading) return;
    if (openedAddCalendarFromQuery.current) return;
    if (searchParams.get('addCalendar') !== '1') return;
    if (!isAdmin) return;
    openedAddCalendarFromQuery.current = true;
    setTab('team');
    queueMicrotask(() => {
      openAdd();
    });
    const next = new URLSearchParams(searchParams.toString());
    next.delete('addCalendar');
    const q = next.toString();
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
  }, [loading, isAdmin, openAdd, pathname, router, searchParams]);

  async function openEdit(p: { id: string; name: string; is_active: boolean }) {
    if (!isAdmin) return;
    setEditingId(p.id);
    setFormName(p.name);
    setFormActive(p.is_active);
    setError(null);
    setCalendarModalError(null);

    const [assoc, svcRes] = await Promise.all([
      fetchAssociationData(),
      fetch('/api/venue/appointment-services'),
    ]);

    let links: PractitionerServiceLink[] = [];
    if (svcRes.ok) {
      const svcData = (await svcRes.json()) as { practitioner_services?: PractitionerServiceLink[] };
      links = (svcData.practitioner_services ?? []) as PractitionerServiceLink[];
      setPLinks(links);
    } else {
      links = pLinks;
    }
    const serviceIds = links.filter((l) => l.practitioner_id === p.id).map((l) => l.service_id);
    setFormServiceIds(serviceIds);

    const types = assoc?.classTypes ?? classTypes;
    const classIds = types.filter((ct) => classTypeUsesCalendarColumn(ct, p.id)).map((ct) => ct.id);
    setFormClassIds(classIds);
    setSnapshotClassIds([...classIds]);

    const resources = assoc?.resourceRows ?? resourceRows;
    const resourceIds = resources.filter((r) => r.display_on_calendar_id === p.id).map((r) => r.id);
    setFormResourceIds(resourceIds);
    setSnapshotResourceIds([...resourceIds]);

    const events = assoc?.experienceEvents ?? experienceEvents;
    const eventIds = events.filter((e) => e.is_active && e.calendar_id === p.id).map((e) => e.id);
    setFormEventIds(eventIds);
    setSnapshotEventIds([...eventIds]);

    setCalendarModalError(null);
    setShowForm(true);
  }

  async function savePractitioner() {
    if (!isAdmin) return;
    if (!formName.trim()) {
      setCalendarModalError('Name is required');
      return;
    }
    setSaving(true);
    setCalendarModalError(null);
    try {
      const payload: Record<string, unknown> = {
        name: formName.trim(),
        is_active: formActive,
      };
      if (editingId) {
        payload.id = editingId;
      } else {
        payload.working_hours = defaultWorkingHours();
        payload.break_times = [];
        payload.days_off = [];
      }

      const res = await fetch('/api/venue/practitioners', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as {
          error?: string;
          upgrade_required?: boolean;
          current?: number;
          limit?: number;
        };
        if (d.upgrade_required || res.status === 403) {
          void refreshCalendarEntitlement();
          setShowUpgradeModal(true);
          throw new Error(
            d.error ??
              'Your plan does not include another calendar. Upgrade your subscription to add more team members.',
          );
        }
        throw new Error(d.error ?? 'Failed to save');
      }

      const practitionerData = await res.json();
      const pracId = editingId ?? practitionerData?.id;

      if (!pracId) {
        throw new Error('Save did not return a calendar id.');
      }

      const editingPracId = pracId as string;
      const fallbackOther = appointmentCalendars.find((p) => p.id !== editingPracId)?.id ?? null;

      const associationSelectionsUnchanged =
        editingId != null &&
        idsEqualAsSets(formClassIds, snapshotClassIds) &&
        idsEqualAsSets(formResourceIds, snapshotResourceIds) &&
        idsEqualAsSets(formEventIds, snapshotEventIds);

      if (!associationSelectionsUnchanged) {
      const freshAssoc = await fetchAssociationData();
      const typesForCompare = freshAssoc?.classTypes ?? classTypes;
      const resourcesForCompare = freshAssoc?.resourceRows ?? resourceRows;
      const eventsActiveForCompare = (freshAssoc?.experienceEvents ?? experienceEvents).filter((e) => e.is_active);

      let hasAssociationChanges = false;
      for (const ct of typesForCompare) {
        if (formClassIds.includes(ct.id) !== classTypeUsesCalendarColumn(ct, editingPracId)) {
          hasAssociationChanges = true;
          break;
        }
      }
      if (!hasAssociationChanges) {
        for (const r of resourcesForCompare) {
          if (formResourceIds.includes(r.id) !== (r.display_on_calendar_id === editingPracId)) {
            hasAssociationChanges = true;
            break;
          }
        }
      }
      if (!hasAssociationChanges) {
        for (const ev of eventsActiveForCompare) {
          if (formEventIds.includes(ev.id) !== (ev.calendar_id === editingPracId)) {
            hasAssociationChanges = true;
            break;
          }
        }
      }

      if (hasAssociationChanges) {
      for (const ct of typesForCompare) {
        const should = formClassIds.includes(ct.id);
        const was = classTypeUsesCalendarColumn(ct, editingPracId);
        if (should === was) continue;
        if (should) {
          const cRes = await fetch('/api/venue/classes', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: ct.id,
              entity_type: 'class_type',
              instructor_id: editingPracId,
            }),
          });
          if (!cRes.ok) {
            const j = (await cRes.json().catch(() => ({}))) as { error?: string };
            throw new Error(j.error ?? 'Could not update a class type for this calendar.');
          }
        } else {
          const cRes = await fetch('/api/venue/classes', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: ct.id,
              entity_type: 'class_type',
              instructor_id: null,
            }),
          });
          if (!cRes.ok) {
            const j = (await cRes.json().catch(() => ({}))) as { error?: string };
            throw new Error(j.error ?? 'Could not remove this class from the calendar.');
          }
        }
      }

      for (const r of resourcesForCompare) {
        const should = formResourceIds.includes(r.id);
        const was = r.display_on_calendar_id === editingPracId;
        if (should === was) continue;
        if (should) {
          const rRes = await fetch('/api/venue/resources', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: r.id, display_on_calendar_id: editingPracId }),
          });
          if (!rRes.ok) {
            const j = (await rRes.json().catch(() => ({}))) as { error?: string };
            throw new Error(j.error ?? 'Could not assign a resource to this calendar.');
          }
        } else {
          if (!fallbackOther) {
            throw new Error(
              'Add another calendar column before moving a resource off this calendar.',
            );
          }
          const rRes = await fetch('/api/venue/resources', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: r.id, display_on_calendar_id: fallbackOther }),
          });
          if (!rRes.ok) {
            const j = (await rRes.json().catch(() => ({}))) as { error?: string };
            throw new Error(j.error ?? 'Could not move a resource to another calendar.');
          }
        }
      }

      for (const ev of eventsActiveForCompare) {
        const should = formEventIds.includes(ev.id);
        const was = ev.calendar_id === editingPracId;
        if (should === was) continue;
        if (should) {
          const evRes = await fetch('/api/venue/experience-events', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: ev.id, calendar_id: editingPracId }),
          });
          if (!evRes.ok) {
            const j = (await evRes.json().catch(() => ({}))) as { error?: string };
            throw new Error(j.error ?? 'Could not assign an event to this calendar.');
          }
        } else {
          const evRes = await fetch('/api/venue/experience-events', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: ev.id, calendar_id: null }),
          });
          if (!evRes.ok) {
            const j = (await evRes.json().catch(() => ({}))) as { error?: string };
            throw new Error(j.error ?? 'Could not remove this event from the calendar.');
          }
        }
      }
      }
      }

      const linkRes = await fetch('/api/venue/practitioner-services', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ practitioner_id: editingPracId, service_ids: formServiceIds }),
      });
      if (!linkRes.ok) {
        const linkJson = (await linkRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(linkJson.error ?? 'Failed to sync service links for this calendar.');
      }

      setShowForm(false);
      flash(editingId ? 'Calendar updated' : 'Calendar added');
      await fetchData();
      await refreshCalendarEntitlement();
    } catch (err) {
      setCalendarModalError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  // ─── Working Hours Tab ──────────────────────────────────────────────
  async function saveWorkingHours(hours: Record<string, Array<{ start: string; end: string }>>) {
    if (!selectedPrac || !canEditWorkingHoursFor(selectedPrac, isAdmin, currentStaffId)) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/venue/practitioners', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selectedPrac.id, working_hours: hours }),
      });
      if (!res.ok) throw new Error('Failed to save');
      flash('Working hours saved');
      await fetchData();
    } catch {
      setError('Failed to save working hours');
    } finally {
      setSaving(false);
    }
  }

  // ─── Breaks Tab ─────────────────────────────────────────────────────
  async function saveBreakSchedule(payload: {
    break_times: TimeRange[];
    break_times_by_day: WorkingHours | null;
  }) {
    if (!selectedPrac || !canEditBreaksFor(selectedPrac, isAdmin, currentStaffId)) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/venue/practitioners', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selectedPrac.id, ...payload }),
      });
      if (!res.ok) throw new Error('Failed to save');
      flash('Breaks saved');
      await fetchData();
    } catch {
      setError('Failed to save breaks');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h1 className={`text-2xl font-semibold text-slate-900 ${isAdmin ? 'mb-6' : 'mb-2'}`}>Availability Settings</h1>

      {!isAdmin && (
        <p className="mb-6 text-sm text-slate-600">
          Browse any team member for reference; only <strong>your</strong> calendar can be changed here. Venue admins
          can adjust everyone.
        </p>
      )}

      {success && (
        <div className="mb-4 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700">{success}</div>
      )}
      {error && !(showForm && isAdmin) && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {/* Tabs */}
      <div className="mb-6 flex gap-1 rounded-lg bg-slate-100 p-1">
        {visibleTabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              tab === t.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <AppointmentAvailabilityTabPanelSkeleton />
      ) : (
        <>
          {/* ─── Team Tab (Calendars) ─── */}
          {tab === 'team' && (
            <div>
              <BookableCalendarsPanel
                practitioners={appointmentCalendars}
                isAdmin={isAdmin}
                services={services}
                pLinks={pLinks}
                classTypes={classTypes}
                resources={resourceRows}
                events={experienceEvents}
                calendarColumnAlerts={calendarColumnAlerts}
                entitlement={entitlement}
                onCalendarsChanged={() => {
                  void fetchData();
                  void refreshCalendarEntitlement();
                }}
                onCalendarReorderSaved={applyCalendarReorder}
                onEditCalendar={openEdit}
                onAddCalendar={openAdd}
              />

              {/* Add/Edit modal */}
              {showForm && isAdmin && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                  <div
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="team-modal-title"
                    className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 pb-[max(1.5rem,env(safe-area-inset-bottom,0px))] shadow-xl sm:pb-6"
                  >
                    <h2 id="team-modal-title" className="mb-4 text-lg font-semibold text-slate-900">
                      {editingId ? 'Edit calendar' : 'Add calendar'}
                    </h2>
                    {calendarModalError && (
                      <div
                        role="alert"
                        className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
                      >
                        {calendarModalError}
                      </div>
                    )}
                    <div className="space-y-4">
                      <div>
                        <label className="mb-1 block text-sm font-medium text-slate-700">Display name *</label>
                        <input
                          type="text"
                          value={formName}
                          onChange={(e) => setFormName(e.target.value)}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                          placeholder="e.g. Staff name or room label"
                        />
                      </div>
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => setFormActive(!formActive)}
                          className={`relative h-6 w-11 rounded-full transition-colors ${formActive ? 'bg-brand-600' : 'bg-slate-300'}`}
                        >
                          <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${formActive ? 'translate-x-5' : 'translate-x-0'}`} />
                        </button>
                        <span className="text-sm text-slate-700">Active (bookable)</span>
                      </div>

                      {services.length > 0 && (
                        <div>
                          <label className="mb-1.5 block text-sm font-medium text-slate-700">Appointment services</label>
                          <p className="mb-2 text-xs text-slate-500">
                            Which services can guests book on this column? The same service can appear on several columns.
                            Leave empty if this column is only for classes or resources.
                          </p>
                          <div className="max-h-36 space-y-2 overflow-y-auto rounded-lg border border-slate-200 p-3">
                            {services.map((svc) => (
                              <label key={svc.id} className="flex cursor-pointer items-center gap-2.5">
                                <input
                                  type="checkbox"
                                  checked={formServiceIds.includes(svc.id)}
                                  onChange={(e) => {
                                    setFormServiceIds((prev) =>
                                      e.target.checked ? [...prev, svc.id] : prev.filter((id) => id !== svc.id),
                                    );
                                  }}
                                  className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                />
                                <span className="text-sm text-slate-700">{svc.name}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}

                      {classTypes.length > 0 && (
                        <div>
                          <label className="mb-1.5 block text-sm font-medium text-slate-700">Class types</label>
                          <p className="mb-2 text-xs text-slate-500">
                            Tick which classes run on this calendar. Each class can only sit on one column; checking moves it
                            here from another. If class times overlap, assign them to different calendars. To remove a class,
                            clear its upcoming sessions and any recurring rule on the Classes page first.
                          </p>
                          <div className="max-h-36 space-y-2 overflow-y-auto rounded-lg border border-slate-200 p-3">
                            {classTypes.map((ct) => (
                              <label key={ct.id} className="flex cursor-pointer items-center gap-2.5">
                                <input
                                  type="checkbox"
                                  checked={formClassIds.includes(ct.id)}
                                  onChange={(e) => {
                                    const checked = e.target.checked;
                                    if (!checked) {
                                      setFormClassIds((prev) => prev.filter((id) => id !== ct.id));
                                      return;
                                    }
                                    const col = ct.instructor_calendar_id ?? ct.instructor_id;
                                    if (col && col !== editingId) {
                                      if (!confirmReassignSingleCalendarEntity(ct.name, col)) return;
                                    }
                                    setFormClassIds((prev) => [...prev, ct.id]);
                                  }}
                                  className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                />
                                <span className="text-sm text-slate-700">{ct.name}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}

                      {resourceRows.length > 0 && (
                        <div>
                          <label className="mb-1.5 block text-sm font-medium text-slate-700">Resources on this column</label>
                          <p className="mb-2 text-xs text-slate-500">
                            Resources must be on a calendar to be bookable. You can assign more than one to this column as
                            long as their weekly hours don’t overlap.
                          </p>
                          <div className="max-h-36 space-y-2 overflow-y-auto rounded-lg border border-slate-200 p-3">
                            {resourceRows.map((r) => (
                              <label key={r.id} className="flex cursor-pointer items-center gap-2.5">
                                <input
                                  type="checkbox"
                                  checked={formResourceIds.includes(r.id)}
                                  onChange={(e) => {
                                    const checked = e.target.checked;
                                    if (!checked) {
                                      setFormResourceIds((prev) => prev.filter((id) => id !== r.id));
                                      return;
                                    }
                                    const col = r.display_on_calendar_id;
                                    if (col && col !== editingId) {
                                      if (!confirmReassignSingleCalendarEntity(r.name, col)) return;
                                    }
                                    setFormResourceIds((prev) => [...prev, r.id]);
                                  }}
                                  className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                />
                                <span className="text-sm text-slate-700">{r.name}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}

                      {experienceEvents.some((e) => e.is_active) && (
                        <div>
                          <label className="mb-1.5 block text-sm font-medium text-slate-700">Ticketed events</label>
                          <p className="mb-2 text-xs text-slate-500">
                            Times on this column must not overlap other items. Events must be on a calendar to be bookable.
                            You cannot remove an event while it has bookings—cancel or resolve those first. Create events in{' '}
                            <Link href="/dashboard/event-manager" className="font-medium text-brand-600 hover:underline">
                              Event manager
                            </Link>
                            .
                          </p>
                          <div className="max-h-36 space-y-2 overflow-y-auto rounded-lg border border-slate-200 p-3">
                            {experienceEvents
                              .filter((e) => e.is_active)
                              .map((ev) => (
                                <label key={ev.id} className="flex cursor-pointer items-center gap-2.5">
                                  <input
                                    type="checkbox"
                                    checked={formEventIds.includes(ev.id)}
                                    onChange={(e) => {
                                      const checked = e.target.checked;
                                      if (!checked) {
                                        setFormEventIds((prev) => prev.filter((id) => id !== ev.id));
                                        return;
                                      }
                                      const col = ev.calendar_id;
                                      if (col && col !== editingId) {
                                        if (!confirmReassignSingleCalendarEntity(ev.name, col)) return;
                                      }
                                      setFormEventIds((prev) => [...prev, ev.id]);
                                    }}
                                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                  />
                                  <span className="text-sm text-slate-700">{ev.name}</span>
                                </label>
                              ))}
                          </div>
                        </div>
                      )}

                    </div>
                    <div className="mt-6 flex justify-end gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setShowForm(false);
                          setCalendarModalError(null);
                        }}
                        className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => void savePractitioner()}
                        disabled={saving}
                        className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                      >
                        {saving ? 'Saving...' : 'Save'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ─── Working Hours / Breaks / Calendar closures ─── */}
          {tab === 'daysoff' && (
            <div>
              {appointmentCalendars.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-white p-12 text-center">
                  <p className="text-slate-500">Add calendars first to set full-day closures and unavailability.</p>
                </div>
              ) : (
                <>
                  {appointmentCalendars.some((p) =>
                    (p.days_off ?? []).some((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)),
                  ) && (
                    <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                      <p className="font-medium">Legacy blocked dates</p>
                      <p className="mt-1 text-amber-900/90">
                        Some calendars still have dates in the older per-calendar “days off” list. Those dates still
                        block booking. Add new blocks here so full-day unavailability stays visible in one place.
                      </p>
                    </div>
                  )}
                  <StaffLeaveCalendarPanel
                    practitioners={appointmentCalendars.map((p) => ({ id: p.id, name: p.name }))}
                    isAdmin={isAdmin}
                    selfPractitionerId={
                      !isAdmin && currentStaffId
                        ? appointmentCalendars.find((p) =>
                            staffIdsForPractitioner(p).includes(currentStaffId),
                          )?.id ?? null
                        : null
                    }
                    onError={setError}
                  />
                </>
              )}
            </div>
          )}

          {(tab === 'hours' || tab === 'breaks') && (
            <div>
              {appointmentCalendars.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-white p-12 text-center">
                  <p className="text-slate-500">Add calendars first to set their schedule.</p>
                </div>
              ) : (
                <>
                  <div className="mb-4">
                    <label className="mb-1 block text-sm font-medium text-slate-700">Calendar</label>
                    <select
                      value={selectedPractitionerId}
                      onChange={(e) => setSelectedPractitionerId(e.target.value)}
                      className="w-full max-w-xs rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    >
                      {practitionersForScheduleTabs.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    {!isAdmin &&
                      selectedPrac &&
                      !canEditWorkingHoursFor(selectedPrac, isAdmin, currentStaffId) && (
                        <p className="mt-2 text-sm text-slate-600">
                          View only - you can change hours and breaks for calendars linked to your account. Ask an admin
                          to edit other calendars.
                        </p>
                      )}
                  </div>

                  {selectedPrac && tab === 'hours' && (
                    <WorkingHoursEditor
                      hours={selectedPrac.working_hours ?? {}}
                      onSave={saveWorkingHours}
                      saving={saving}
                      readOnly={!canEditWorkingHoursFor(selectedPrac, isAdmin, currentStaffId)}
                      readOnlyHint={
                        !canEditWorkingHoursFor(selectedPrac, isAdmin, currentStaffId) && !isAdmin
                          ? 'View only - this calendar is not linked to your account. You can edit working hours on calendars you manage, or ask an admin.'
                          : undefined
                      }
                    />
                  )}

                  {selectedPrac && tab === 'breaks' && (
                    <>
                      {canEditBreaksFor(selectedPrac, isAdmin, currentStaffId) && (
                        <p className="mb-4 text-sm text-slate-600">
                          Breaks are short windows on a day when this calendar stays closed to bookings (for example a
                          lunch break), using the working-hours window you set on the Working hours tab. Guests cannot book
                          during a break.
                        </p>
                      )}
                      <BreaksScheduleEditor
                        key={`${selectedPrac.id}:${JSON.stringify(selectedPrac.break_times)}:${JSON.stringify(selectedPrac.break_times_by_day ?? null)}`}
                        practitioner={selectedPrac}
                        onSave={saveBreakSchedule}
                        saving={saving}
                        readOnly={!canEditBreaksFor(selectedPrac, isAdmin, currentStaffId)}
                        readOnlyHint={
                          !canEditBreaksFor(selectedPrac, isAdmin, currentStaffId) && !isAdmin
                            ? 'View only - you can edit breaks for calendars linked to your account only.'
                            : undefined
                        }
                      />
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}

      {showUpgradeModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="upgrade-modal-title"
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
          >
            <h2 id="upgrade-modal-title" className="text-lg font-semibold text-slate-900">
              Upgrade to add more calendars
            </h2>
            <p className="mt-3 text-sm text-slate-600">
              Your current subscription includes a limited number of calendars (team members). To add another practitioner,
              visit your plan settings to adjust your calendar allowance.
            </p>
            {entitlement && !entitlement.unlimited && entitlement.calendar_limit != null && (
              <p className="mt-2 text-sm text-slate-700">
                You are using{' '}
                <span className="font-semibold">
                  {entitlement.active_practitioners} of {entitlement.calendar_limit}
                </span>{' '}
                calendar{entitlement.calendar_limit === 1 ? '' : 's'}.
              </p>
            )}
            <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setShowUpgradeModal(false)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Close
              </button>
              <Link
                href="/dashboard/settings?tab=plan"
                className="inline-flex justify-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
              >
                View plans &amp; upgrade
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Working Hours Editor ─────────────────────────────────────────────────
function WorkingHoursEditor({
  hours,
  onSave,
  saving,
  readOnly = false,
  readOnlyHint,
}: {
  hours: Record<string, Array<{ start: string; end: string }>>;
  onSave: (hours: Record<string, Array<{ start: string; end: string }>>) => void;
  saving: boolean;
  readOnly?: boolean;
  readOnlyHint?: string;
}) {
  const [draft, setDraft] = useState(hours);

  useEffect(() => {
    setDraft(hours);
  }, [hours]);

  return (
    <div className="space-y-3">
      <WorkingHoursControl value={draft} onChange={setDraft} disabled={readOnly} />

      {!readOnly && (
        <button
          type="button"
          onClick={() => onSave(draft)}
          disabled={saving}
          className="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Working Hours'}
        </button>
      )}
      {readOnly && (
        <p className="mt-4 text-sm text-slate-500">
          {readOnlyHint ?? "You can't edit working hours for this calendar."}
        </p>
      )}
    </div>
  );
}

function emptyBreaksByDay(): WorkingHours {
  const o: WorkingHours = {};
  for (const k of DAY_KEYS) o[k] = [];
  return o;
}

function breaksByDayFromPractitioner(p: Practitioner): WorkingHours {
  const src = p.break_times_by_day;
  const o = emptyBreaksByDay();
  if (src && typeof src === 'object' && !Array.isArray(src)) {
    for (const k of DAY_KEYS) {
      const r = src[k];
      o[k] = Array.isArray(r) ? r.map((x) => ({ ...x })) : [];
    }
  }
  return o;
}

/** Prefer stored per-day breaks; otherwise repeat legacy `break_times` on every weekday key. */
function initialBreaksByDayFromPractitioner(p: Practitioner): WorkingHours {
  const hasPerDay =
    p.break_times_by_day &&
    typeof p.break_times_by_day === 'object' &&
    !Array.isArray(p.break_times_by_day) &&
    Object.keys(p.break_times_by_day).length > 0;

  if (hasPerDay) {
    return breaksByDayFromPractitioner(p);
  }

  const daily = Array.isArray(p.break_times) ? p.break_times.map((x) => ({ ...x })) : [];
  const o = emptyBreaksByDay();
  for (const k of DAY_KEYS) {
    o[k] = daily.map((x) => ({ ...x }));
  }
  return o;
}

const MONDAY_DAY_KEY = DAY_KEYS[0]!;

// ─── Breaks: one row per weekday (same as Working hours layout) ───────────
function BreaksScheduleEditor({
  practitioner,
  onSave,
  saving,
  readOnly = false,
  readOnlyHint,
}: {
  practitioner: Practitioner;
  onSave: (payload: { break_times: TimeRange[]; break_times_by_day: WorkingHours | null }) => void;
  saving: boolean;
  readOnly?: boolean;
  readOnlyHint?: string;
}) {
  const [byDayBreaks, setByDayBreaks] = useState<WorkingHours>(() => initialBreaksByDayFromPractitioner(practitioner));

  function addBreakForDay(dayKey: string) {
    setByDayBreaks((prev) => ({
      ...prev,
      [dayKey]: [...(prev[dayKey] ?? []), { start: '12:00', end: '13:00' }],
    }));
  }

  function updateBreakForDay(dayKey: string, index: number, field: 'start' | 'end', value: string) {
    setByDayBreaks((prev) => {
      const ranges = [...(prev[dayKey] ?? [])];
      ranges[index] = { ...ranges[index]!, [field]: value };
      return { ...prev, [dayKey]: ranges };
    });
  }

  function removeBreakForDay(dayKey: string, index: number) {
    setByDayBreaks((prev) => {
      const ranges = [...(prev[dayKey] ?? [])];
      ranges.splice(index, 1);
      return { ...prev, [dayKey]: ranges };
    });
  }

  function copyMondayToAllDays() {
    const template = (byDayBreaks[MONDAY_DAY_KEY] ?? []).map((b) => ({ ...b }));
    setByDayBreaks((prev) => {
      const next: WorkingHours = { ...prev };
      for (const k of DAY_KEYS) {
        next[k] = template.map((b) => ({ ...b }));
      }
      return next;
    });
  }

  function handleSave() {
    const full: WorkingHours = {};
    for (const k of DAY_KEYS) full[k] = [...(byDayBreaks[k] ?? [])];
    onSave({ break_times: [], break_times_by_day: full });
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        For each day of the week, add one or more breaks when this calendar should not offer appointments. Leave a day
        with no breaks if it stays bookable for the full working-hours window that day. If several days share the same
        pattern, set Monday first and use{' '}
        <span className="font-medium text-slate-800">Copy Monday to all days</span>.
      </p>

      {!readOnly && (
        <button
          type="button"
          onClick={copyMondayToAllDays}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
        >
          Copy Monday to all days
        </button>
      )}

      <div className="space-y-3">
        {DAY_KEYS.map((dayKey, i) => {
          const ranges = byDayBreaks[dayKey] ?? [];
          return (
            <div key={dayKey} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-slate-900">{DAY_LABELS[i]}</span>
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => addBreakForDay(dayKey)}
                    className="text-xs font-medium text-blue-600 hover:underline"
                  >
                    + Add break
                  </button>
                )}
              </div>
              {ranges.length === 0 ? (
                <p className="mt-1 text-xs text-slate-400">No breaks - bookable for the full working-hours window</p>
              ) : (
                <div className="mt-2 space-y-2">
                  {ranges.map((r, ri) => (
                    <div key={ri} className="flex flex-wrap items-center gap-2">
                      <input
                        type="time"
                        value={r.start}
                        onChange={(e) => updateBreakForDay(dayKey, ri, 'start', e.target.value)}
                        disabled={readOnly}
                        className="rounded-lg border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-50"
                      />
                      <span className="text-sm text-slate-400">to</span>
                      <input
                        type="time"
                        value={r.end}
                        onChange={(e) => updateBreakForDay(dayKey, ri, 'end', e.target.value)}
                        disabled={readOnly}
                        className="rounded-lg border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-50"
                      />
                      {!readOnly && (
                        <button
                          type="button"
                          onClick={() => removeBreakForDay(dayKey, ri)}
                          className="text-xs text-red-500 hover:underline"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {!readOnly && (
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save breaks'}
        </button>
      )}
      {readOnly && (
        <p className="text-sm text-slate-500">
          {readOnlyHint ??
            'You can only edit breaks for calendars linked to your account. Ask an admin to select a different calendar.'}
        </p>
      )}
    </div>
  );
}
