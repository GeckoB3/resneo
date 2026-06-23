'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { readResponseJson } from '@/lib/api/read-response-json';
import { currencySymbolFromCode } from '@/lib/money/currency-symbol';
import { Dialog } from '@/components/ui/primitives/Dialog';
import {
  AppointmentServiceModal,
  type ServiceModalCalendar,
} from '@/components/dashboard/appointment-services/AppointmentServiceModal';
import type { AppointmentServiceFormValues } from '@/components/dashboard/appointment-services/appointment-service-form-values';
import { SearchableEntitySelect } from '@/components/import/SearchableEntitySelect';
import type { OpeningHours } from '@/types/availability';
import { parseVenueOpeningExceptions, type VenueOpeningException } from '@/types/venue-opening-exceptions';
import type { WorkingHours } from '@/types/booking-models';

type ExtractResponse = {
  ok?: boolean;
  error?: string;
  referencesResolved?: boolean;
  futureRowCount?: number;
  extractedReferenceCount?: number;
  insertedBookingRowCount?: number;
  staffReferenceCount?: number;
  requiresTableConfirmation?: boolean;
  bookingModel?: string;
  mode?: string;
};

type BookingRef = {
  id: string;
  file_id?: string;
  reference_type: string;
  raw_value: string;
  booking_count?: number;
  is_resolved: boolean;
  ai_suggested_entity_id?: string | null;
  ai_suggested_entity_name?: string | null;
  ai_confidence?: string | null;
  resolution_action?: string | null;
};

type RefDefault = {
  reference_id: string;
  suggested_duration_minutes: number | null;
  suggested_price_pence: number | null;
  sample_count: number;
};

type CreateDraft = {
  name: string;
  duration: string;
  price: string;
};

/** One editable row in the "Create all new" review panel. */
type BulkRow = {
  reference_id: string;
  selected: boolean;
  name: string;
  /** Services only. Minutes as a string for the input; staff rows ignore these. */
  duration: string;
  price: string;
};

type BulkResult = {
  ok: boolean;
  created: number;
  errors: { reference_id: string; error: string }[];
};

/** Venue context the full Add Service modal needs, fetched lazily on first use. */
type ServiceFormContext = {
  openingHours: OpeningHours | null;
  openingExceptions: VenueOpeningException[];
  stripeConnected: boolean;
  currencySymbol: string;
  calendars: ServiceModalCalendar[];
};

type Catalog = {
  bookingModel: string;
  serviceItems: { id: string; name: string }[];
  calendars: { id: string; name: string }[];
  practitioners: { id: string; name: string }[];
  appointmentServices: { id: string; name: string }[];
  eventSessions?: { id: string; name: string }[];
  classInstances?: { id: string; name: string }[];
  resourceCalendars?: { id: string; name: string }[];
};

const KNOWN_REFERENCE_TYPES = ['service', 'staff', 'event', 'class', 'resource'] as const;
const OTHER_TAB = '_other';

function isKnownReferenceType(t: string): t is (typeof KNOWN_REFERENCE_TYPES)[number] {
  return (KNOWN_REFERENCE_TYPES as readonly string[]).includes(t);
}

export function ReferencesStepClient({ sessionId }: { sessionId: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [extract, setExtract] = useState<ExtractResponse | null>(null);
  const [refs, setRefs] = useState<BookingRef[]>([]);
  const [resolvedFlag, setResolvedFlag] = useState(false);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [tab, setTab] = useState<string>('service');
  const [confirming, setConfirming] = useState(false);
  const [ack, setAck] = useState(false);
  const [mappingId, setMappingId] = useState<string | null>(null);
  const [bulkAccepting, setBulkAccepting] = useState(false);
  const [selectByRef, setSelectByRef] = useState<Record<string, string>>({});
  const [fileTypeById, setFileTypeById] = useState<Record<string, string>>({});
  const [defaultsByRef, setDefaultsByRef] = useState<Record<string, RefDefault>>({});
  const [createOpenByRef, setCreateOpenByRef] = useState<Record<string, boolean>>({});
  const [createDraftByRef, setCreateDraftByRef] = useState<Record<string, CreateDraft>>({});
  // Full "Add service" modal (service refs only): the ref being created, the
  // venue context the form needs, and a per-ref "opening…" flag while context loads.
  const [serviceModalRefId, setServiceModalRefId] = useState<string | null>(null);
  const [openingModalRefId, setOpeningModalRefId] = useState<string | null>(null);
  const [svcContext, setSvcContext] = useState<ServiceFormContext | null>(null);
  // Catalogue fetch lifecycle, tracked so a failed fetch shows an error + Retry
  // instead of silently hiding every control (M9).
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogRetrying, setCatalogRetrying] = useState(false);
  // Venue currency symbol for price inputs; '£' until the catalogue load resolves it.
  const [currencySymbol, setCurrencySymbol] = useState('£');
  // Bulk "Create all new" review panel, keyed by reference type ('service' | 'staff').
  const [bulkType, setBulkType] = useState<string | null>(null);
  const [bulkRows, setBulkRows] = useState<BulkRow[]>([]);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkResult, setBulkResult] = useState<BulkResult | null>(null);

  const loadSession = useCallback(async () => {
    const res = await fetch(`/api/import/sessions/${sessionId}`);
    const data = await readResponseJson<{
      session?: { references_resolved?: boolean };
      booking_references?: BookingRef[];
      files?: Array<{ id: string; file_type: string }>;
      error?: string;
    }>(res);
    if (!res.ok) throw new Error(data.error ?? 'Failed to load session');
    setRefs((data.booking_references ?? []) as BookingRef[]);
    setResolvedFlag(data.session?.references_resolved === true);
    const ft: Record<string, string> = {};
    for (const f of data.files ?? []) ft[f.id] = f.file_type;
    setFileTypeById(ft);
  }, [sessionId]);

  const loadDefaults = useCallback(async () => {
    try {
      const res = await fetch(`/api/import/sessions/${sessionId}/reference-defaults`);
      if (!res.ok) return;
      const data = await readResponseJson<{ suggestions?: RefDefault[] }>(res);
      const map: Record<string, RefDefault> = {};
      for (const s of data.suggestions ?? []) map[s.reference_id] = s;
      setDefaultsByRef(map);
    } catch {
      /* prefill suggestions are best-effort */
    }
  }, [sessionId]);

  /**
   * Fetch the selectable-entities catalogue. On failure we keep `catalog` null
   * and surface a clear error + Retry rather than silently hiding all controls (M9).
   */
  const loadCatalog = useCallback(async () => {
    setCatalogError(null);
    try {
      const catRes = await fetch(`/api/import/sessions/${sessionId}/reference-catalog`);
      const cat = await readResponseJson<Catalog & { error?: string }>(catRes);
      if (!catRes.ok) throw new Error(cat.error ?? 'Could not load your services and staff list');
      setCatalog(cat);
      return true;
    } catch (e) {
      setCatalogError(e instanceof Error ? e.message : 'Could not load your services and staff list');
      return false;
    }
  }, [sessionId]);

  /** Best-effort venue currency symbol for the bulk-create price inputs. */
  const loadCurrency = useCallback(async () => {
    try {
      const res = await fetch('/api/venue');
      if (!res.ok) return;
      const data = await readResponseJson<{ currency?: string }>(res);
      setCurrencySymbol(currencySymbolFromCode(data.currency ?? 'GBP'));
    } catch {
      /* currency symbol is cosmetic; '£' is a safe default */
    }
  }, []);

  const runExtract = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/import/sessions/${sessionId}/extract-references`, { method: 'POST' });
      const data = await readResponseJson<ExtractResponse>(res);
      if (!res.ok) throw new Error(data.error ?? 'Failed to analyse booking references');
      setExtract(data);
      await loadSession();
      const sesRes = await fetch(`/api/import/sessions/${sessionId}`);
      const extracted = await readResponseJson<{ booking_references?: BookingRef[] }>(sesRes);
      const br = extracted.booking_references ?? [];
      if (br.some((x) => !x.is_resolved)) {
        await fetch(`/api/import/sessions/${sessionId}/ai-map-references`, { method: 'POST' });
        await loadSession();
      }
      await Promise.all([loadCatalog(), loadDefaults(), loadCurrency()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
    setLoading(false);
  }, [sessionId, loadSession, loadDefaults, loadCatalog, loadCurrency]);

  async function retryCatalog() {
    setCatalogRetrying(true);
    await loadCatalog();
    setCatalogRetrying(false);
  }

  // Run the (delete-then-restage) extraction exactly once per mount. Without
  // this guard React strict mode double-invokes the effect in dev, firing two
  // concurrent extract-references calls that race on the booking-row insert and
  // fail with a duplicate-key error on large files.
  const extractStartedRef = useRef(false);
  useEffect(() => {
    if (extractStartedRef.current) return;
    extractStartedRef.current = true;
    void runExtract();
  }, [runExtract]);

  async function confirmTable() {
    setConfirming(true);
    setError(null);
    try {
      const res = await fetch(`/api/import/sessions/${sessionId}/confirm-table-unassigned`, {
        method: 'POST',
      });
      const data = await readResponseJson<{ ok?: boolean; error?: string }>(res);
      if (!res.ok) throw new Error(data.error ?? 'Could not confirm');
      setExtract((prev) => (prev ? { ...prev, referencesResolved: true, requiresTableConfirmation: false } : prev));
      setResolvedFlag(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
    setConfirming(false);
  }

  const resolved = extract?.referencesResolved === true || resolvedFlag;

  const tabTypes = useMemo((): string[] => {
    const unresolved = refs.filter((r) => !r.is_resolved);
    const types = new Set(unresolved.map((r) => r.reference_type));
    const ordered: string[] = KNOWN_REFERENCE_TYPES.filter((t) => types.has(t));
    const hasUnknownType = unresolved.some((r) => !isKnownReferenceType(r.reference_type));
    if (hasUnknownType) ordered.push(OTHER_TAB);
    return ordered;
  }, [refs]);

  const showReferenceMapping =
    !extract?.requiresTableConfirmation && Boolean(catalog) && refs.some((r) => !r.is_resolved);

  const filtered = useMemo(() => {
    const unresolved = refs.filter((r) => !r.is_resolved);
    if (unresolved.length > 0 && tabTypes.length === 0) {
      return unresolved;
    }
    if (tab === OTHER_TAB) {
      return refs.filter((r) => !r.is_resolved && !isKnownReferenceType(r.reference_type));
    }
    return refs.filter((r) => r.reference_type === tab);
  }, [refs, tab, tabTypes.length]);

  const tabLabel = (t: string) => {
    if (t === 'service') return 'Services';
    if (t === 'staff') return 'Staff';
    if (t === 'event') return 'Events';
    if (t === 'class') return 'Classes';
    if (t === 'resource') return 'Resources';
    if (t === OTHER_TAB) return 'Other';
    return t;
  };

  useEffect(() => {
    if (tabTypes.length && !tabTypes.includes(tab)) {
      setTab(tabTypes[0]!);
    }
  }, [tabTypes, tab]);

  function entityTypeForRef(ref: BookingRef):
    | 'service_item'
    | 'appointment_service'
    | 'unified_calendar'
    | 'practitioner'
    | 'event_session'
    | 'class_instance'
    | undefined {
    if (ref.reference_type === 'service') {
      return catalog?.bookingModel === 'practitioner_appointment' ? 'appointment_service' : 'service_item';
    }
    if (ref.reference_type === 'staff') {
      return catalog?.bookingModel === 'practitioner_appointment' ? 'practitioner' : 'unified_calendar';
    }
    if (ref.reference_type === 'event') return 'event_session';
    if (ref.reference_type === 'class') return 'class_instance';
    if (ref.reference_type === 'resource') return 'unified_calendar';
    return undefined;
  }

  /** PATCH one reference as mapped; returns true on success. Does not reload. */
  async function resolveReferenceOnServer(ref: BookingRef, pick: string): Promise<boolean> {
    const resolved_entity_type = entityTypeForRef(ref);
    const res = await fetch(`/api/import/sessions/${sessionId}/references/${ref.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resolution_action: 'map',
        resolved_entity_id: pick,
        resolved_entity_type,
      }),
    });
    if (!res.ok) {
      const data = await readResponseJson<{ error?: string }>(res);
      throw new Error(data.error ?? 'Could not save');
    }
    return true;
  }

  async function reloadResolvedFlag() {
    await loadSession();
    const ses = await fetch(`/api/import/sessions/${sessionId}`);
    const j = await readResponseJson<{ session?: { references_resolved?: boolean } }>(ses);
    setResolvedFlag(j.session?.references_resolved === true);
  }

  async function applyMap(ref: BookingRef) {
    const pick = selectByRef[ref.id] ?? ref.ai_suggested_entity_id ?? '';
    if (!pick) return;
    setMappingId(ref.id);
    setError(null);
    try {
      await resolveReferenceOnServer(ref, pick);
      await reloadResolvedFlag();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
    setMappingId(null);
  }

  /** Accept every outstanding AI suggestion in one go. */
  async function acceptAllSuggestions() {
    const accepting = refs.filter((r) => !r.is_resolved && r.ai_suggested_entity_id);
    if (!accepting.length) return;
    setBulkAccepting(true);
    setError(null);
    let failures = 0;
    for (const ref of accepting) {
      try {
        await resolveReferenceOnServer(ref, ref.ai_suggested_entity_id!);
      } catch {
        failures += 1;
      }
    }
    try {
      await reloadResolvedFlag();
    } catch {
      /* reload best-effort */
    }
    if (failures > 0) {
      setError(`${failures} suggestion${failures === 1 ? '' : 's'} could not be applied — match those below.`);
    }
    setBulkAccepting(false);
  }

  async function applySkip(ref: BookingRef) {
    setMappingId(ref.id);
    setError(null);
    try {
      const res = await fetch(`/api/import/sessions/${sessionId}/references/${ref.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolution_action: 'skip' }),
      });
      const data = await readResponseJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(data.error ?? 'Could not save');
      await reloadResolvedFlag();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
    setMappingId(null);
  }

  function defaultDraftForRef(ref: BookingRef): CreateDraft {
    const d = defaultsByRef[ref.id];
    return {
      name: ref.raw_value,
      // Services fall back to a sensible 60 min when the file gave no duration
      // evidence; staff ignore this field.
      duration: d?.suggested_duration_minutes ? String(d.suggested_duration_minutes) : '60',
      price: d?.suggested_price_pence != null ? (d.suggested_price_pence / 100).toFixed(2) : '',
    };
  }

  function toggleCreate(ref: BookingRef) {
    setCreateDraftByRef((prev) => ({ ...prev, [ref.id]: prev[ref.id] ?? defaultDraftForRef(ref) }));
    setCreateOpenByRef((prev) => ({ ...prev, [ref.id]: !prev[ref.id] }));
  }

  function createButtonLabel(ref: BookingRef): string | null {
    if (ref.reference_type === 'service') return 'Add as new service';
    if (ref.reference_type === 'staff') {
      return catalog?.bookingModel === 'practitioner_appointment'
        ? 'Add as new practitioner'
        : 'Add as bookable staff';
    }
    return null;
  }

  /** Create the service/staff entity from the inline setup form. */
  async function applyCreate(ref: BookingRef) {
    const draft = createDraftByRef[ref.id] ?? defaultDraftForRef(ref);
    setMappingId(ref.id);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        resolution_action: 'create',
        create_label: draft.name.trim() || ref.raw_value,
      };
      if (ref.reference_type === 'service') {
        const duration = Number.parseInt(draft.duration, 10);
        if (Number.isFinite(duration) && duration > 0) body.create_duration_minutes = duration;
        const cleanPrice = draft.price.replace(/[£,\s]/g, '');
        const pounds = Number.parseFloat(cleanPrice);
        if (cleanPrice !== '' && Number.isFinite(pounds) && pounds >= 0) {
          body.create_price_pence = Math.round(pounds * 100);
        }
      }
      const res = await fetch(`/api/import/sessions/${sessionId}/references/${ref.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await readResponseJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(data.error ?? 'Could not create');
      setCreateOpenByRef((prev) => ({ ...prev, [ref.id]: false }));
      await reloadResolvedFlag();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
    setMappingId(null);
  }

  /** Load venue context for the full service form once; returns it (or null on failure). */
  const ensureServiceContext = useCallback(async (): Promise<ServiceFormContext | null> => {
    if (svcContext) return svcContext;
    try {
      const [venueRes, practRes] = await Promise.all([
        fetch('/api/venue'),
        fetch('/api/venue/practitioners?roster=1'),
      ]);
      const venue = await readResponseJson<{
        opening_hours?: OpeningHours | null;
        venue_opening_exceptions?: unknown;
        currency?: string;
        stripe_connected_account_id?: string | null;
      }>(venueRes);
      const pract = await readResponseJson<{
        practitioners?: Array<{
          id: string;
          name: string;
          is_active?: boolean;
          calendar_type?: string;
          working_hours?: WorkingHours | null;
        }>;
      }>(practRes);
      const calendars: ServiceModalCalendar[] = (pract.practitioners ?? [])
        .filter((p) => p.is_active !== false && p.calendar_type !== 'resource')
        .map((p) => ({ id: p.id, name: p.name, working_hours: p.working_hours ?? null }));
      const ctx: ServiceFormContext = {
        openingHours: venue.opening_hours ?? null,
        openingExceptions: parseVenueOpeningExceptions(venue.venue_opening_exceptions),
        stripeConnected: Boolean(venue.stripe_connected_account_id),
        currencySymbol: currencySymbolFromCode(venue.currency ?? 'GBP'),
        calendars,
      };
      setSvcContext(ctx);
      return ctx;
    } catch {
      setError('Could not load service setup details — please try again.');
      return null;
    }
  }, [svcContext]);

  /** Open the full Add Service modal for a service reference (loads context first). */
  async function openServiceModal(ref: BookingRef) {
    setError(null);
    setOpeningModalRefId(ref.id);
    const ctx = await ensureServiceContext();
    setOpeningModalRefId(null);
    if (ctx) setServiceModalRefId(ref.id);
  }

  /** After the modal creates a real service, link it to the reference and log it for undo. */
  async function handleServiceCreated(ref: BookingRef, created: { id: string; name: string }) {
    setServiceModalRefId(null);
    setMappingId(ref.id);
    setError(null);
    try {
      await resolveReferenceOnServer(ref, created.id);
      // Services created via the real services API aren't tracked by the import;
      // log an import_record so undo reverses this one too (best-effort).
      const entityType = entityTypeForRef(ref);
      if (entityType === 'service_item' || entityType === 'appointment_service') {
        await fetch(`/api/import/sessions/${sessionId}/record-created-entity`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entity_id: created.id, entity_type: entityType }),
        }).catch(() => {});
      }
      await reloadResolvedFlag();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
    setMappingId(null);
  }

  /** Seed values for the full service form from the booking-data suggestions. */
  function initialServiceForm(ref: BookingRef): Partial<AppointmentServiceFormValues> {
    const d = defaultsByRef[ref.id];
    return {
      name: ref.raw_value,
      ...(d?.suggested_duration_minutes ? { duration_minutes: d.suggested_duration_minutes } : {}),
      price: d?.suggested_price_pence != null ? (d.suggested_price_pence / 100).toFixed(2) : '',
    };
  }

  function optionsForRef(ref: BookingRef): { id: string; name: string }[] {
    if (!catalog) return [];
    if (ref.reference_type === 'service') {
      if (catalog.bookingModel === 'practitioner_appointment') return catalog.appointmentServices;
      return catalog.serviceItems;
    }
    if (ref.reference_type === 'staff') {
      if (catalog.bookingModel === 'practitioner_appointment') return catalog.practitioners;
      return catalog.calendars;
    }
    if (ref.reference_type === 'event') return catalog.eventSessions ?? [];
    if (ref.reference_type === 'class') return catalog.classInstances ?? [];
    if (ref.reference_type === 'resource') return catalog.resourceCalendars ?? [];
    return [];
  }

  // ---- Bulk "create all new" (services + staff) ----------------------------

  /** Unmatched, creatable references of a type, with their suggested setup values. */
  const unmatchedOfType = useCallback(
    (type: 'service' | 'staff') => refs.filter((r) => !r.is_resolved && r.reference_type === type),
    [refs],
  );

  const unmatchedServiceCount = useMemo(() => unmatchedOfType('service').length, [unmatchedOfType]);
  const unmatchedStaffCount = useMemo(() => unmatchedOfType('staff').length, [unmatchedOfType]);

  /** How many entities the venue already has for a reference type. */
  function existingCountForType(type: 'service' | 'staff'): number {
    if (!catalog) return 0;
    if (type === 'service') {
      return catalog.bookingModel === 'practitioner_appointment'
        ? catalog.appointmentServices.length
        : catalog.serviceItems.length;
    }
    return catalog.bookingModel === 'practitioner_appointment'
      ? catalog.practitioners.length
      : catalog.calendars.length;
  }

  /**
   * A venue is "fresh" for services when its booking files name several services
   * but the catalogue holds few/none — i.e. setting them up one-by-one is the wrong
   * default and we should lead with the build-from-bookings hero.
   */
  const servicesLookFresh = useMemo(() => {
    if (!catalog) return false;
    return unmatchedServiceCount >= 3 && existingCountForType('service') <= unmatchedServiceCount;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- existingCountForType reads catalog, listed below
  }, [catalog, unmatchedServiceCount]);

  const staffNoun = catalog?.bookingModel === 'practitioner_appointment' ? 'practitioner' : 'team member';

  function bulkButtonLabel(type: 'service' | 'staff'): string {
    if (type === 'service') {
      const n = unmatchedServiceCount;
      return `Create ${n} new ${n === 1 ? 'service' : 'services'} from your bookings`;
    }
    const n = unmatchedStaffCount;
    return `Add ${n} new ${n === 1 ? staffNoun : `${staffNoun}s`}`;
  }

  /** Open the bulk review panel for a type, seeding each row from booking suggestions. */
  function openBulkPanel(type: 'service' | 'staff') {
    const rows: BulkRow[] = unmatchedOfType(type).map((r) => {
      const d = defaultsByRef[r.id];
      return {
        reference_id: r.id,
        selected: true,
        name: r.raw_value,
        duration: d?.suggested_duration_minutes ? String(d.suggested_duration_minutes) : '60',
        price: d?.suggested_price_pence != null ? (d.suggested_price_pence / 100).toFixed(2) : '',
      };
    });
    setBulkRows(rows);
    setBulkResult(null);
    setBulkType(type);
  }

  function closeBulkPanel() {
    setBulkType(null);
    setBulkRows([]);
    setBulkResult(null);
  }

  function patchBulkRow(refId: string, patch: Partial<BulkRow>) {
    setBulkRows((prev) => prev.map((r) => (r.reference_id === refId ? { ...r, ...patch } : r)));
  }

  /** Send every selected bulk row to the bulk endpoint as action:'create'. */
  async function runBulkCreate() {
    if (!bulkType) return;
    const isService = bulkType === 'service';
    const chosen = bulkRows.filter((r) => r.selected && r.name.trim());
    if (!chosen.length) return;
    const resolved_entity_type =
      isService
        ? catalog?.bookingModel === 'practitioner_appointment'
          ? 'appointment_service'
          : 'service_item'
        : catalog?.bookingModel === 'practitioner_appointment'
          ? 'practitioner'
          : 'unified_calendar';

    const operations = chosen.map((row) => {
      const op: Record<string, unknown> = {
        reference_id: row.reference_id,
        action: 'create',
        resolved_entity_type,
        create_label: row.name.trim(),
      };
      if (isService) {
        const duration = Number.parseInt(row.duration, 10);
        op.create_duration_minutes = Number.isFinite(duration) && duration > 0 ? duration : null;
        const cleanPrice = row.price.replace(/[£,\s]/g, '');
        const pounds = Number.parseFloat(cleanPrice);
        op.create_price_pence =
          cleanPrice !== '' && Number.isFinite(pounds) && pounds >= 0 ? Math.round(pounds * 100) : null;
      }
      return op;
    });

    setBulkRunning(true);
    setError(null);
    try {
      const res = await fetch(`/api/import/sessions/${sessionId}/references/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operations }),
      });
      const data = await readResponseJson<{
        ok?: boolean;
        created?: number;
        errors?: { reference_id: string; error: string }[];
        error?: string;
      }>(res);
      if (!res.ok) throw new Error(data.error ?? 'Could not create those items');
      const errs = data.errors ?? [];
      setBulkResult({ ok: errs.length === 0, created: data.created ?? 0, errors: errs });
      // Keep only the rows that failed so the user can retry just those.
      if (errs.length) {
        const failedIds = new Set(errs.map((e) => e.reference_id));
        setBulkRows((prev) => prev.filter((r) => failedIds.has(r.reference_id)));
      } else {
        setBulkRows([]);
      }
      await reloadResolvedFlag();
      await loadCatalog();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
    setBulkRunning(false);
  }

  const selectedBulkCount = bulkRows.filter((r) => r.selected && r.name.trim()).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Set up services &amp; staff</h1>
        <p className="mt-1 text-sm text-slate-600">
          The services and staff named in your files are matched to what you already have on ResNeo. Anything we
          couldn&apos;t match can be added as new right here — services just need a duration and price. Complete this
          step before validation.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">{error}</div>
      )}

      {loading && (
        <div className="space-y-2" role="status">
          <div className="flex items-center gap-2">
            <div className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
            <p className="text-sm text-slate-600">Analysing booking file…</p>
          </div>
          <p className="text-xs text-slate-500">Large files can take a minute — this runs on the server.</p>
        </div>
      )}

      {!loading && extract && (
        <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-800">
          <p>
            <span className="font-medium">Future booking rows:</span>{' '}
            {(extract.futureRowCount ?? 0).toLocaleString()}
          </p>
          {(extract.insertedBookingRowCount ?? 0) > 0 && (
            <p className="text-slate-600">
              Staged <strong>{extract.insertedBookingRowCount}</strong> row(s) for import processing.
            </p>
          )}
          {(extract.staffReferenceCount ?? 0) > 0 && (
            <p className="text-slate-600">
              Found <strong>{extract.staffReferenceCount}</strong> staff member(s) in your staff list — match or add
              them under the Staff tab below.
            </p>
          )}
          {extract.mode === 'no_future_rows' && (
            <p className="text-slate-600">No future-dated rows — this step is not required.</p>
          )}
          {extract.mode === 'no_booking_date_mapping' && (
            <p className="text-slate-600">
              No <strong>Booking date</strong> column mapping — reference matching was skipped. Map booking date on the
              Map step if you need it.
            </p>
          )}
          {extract.requiresTableConfirmation && (
            <div className="space-y-3 border-t border-slate-100 pt-3">
              <p className="font-medium text-slate-900">Table reservations</p>
              <p className="text-slate-600">
                Imported reservations will use your default dining area. Specific table names in the file are not
                matched to floor-plan tables; guests may be noted manually after import.
              </p>
              <label className="flex cursor-pointer items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-1 rounded border-slate-300"
                  checked={ack}
                  onChange={(e) => setAck(e.target.checked)}
                />
                <span>I understand that table assignments from the file are not applied automatically.</span>
              </label>
              <button
                type="button"
                disabled={!ack || confirming || resolved}
                onClick={() => void confirmTable()}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {confirming ? 'Saving…' : 'Confirm and continue'}
              </button>
            </div>
          )}
          {/* M9: catalogue fetch failed — show a clear error + Retry instead of
              silently hiding all the Map / Add / Skip controls. */}
          {!extract.requiresTableConfirmation && !catalog && catalogError && refs.some((r) => !r.is_resolved) && (
            <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">
              <p className="font-medium text-amber-900">We couldn&apos;t load your services and staff</p>
              <p className="text-amber-800">{catalogError}</p>
              <p className="text-xs text-amber-700">
                This is needed to match the items in your file. It&apos;s usually a brief network hiccup — try again.
              </p>
              <button
                type="button"
                disabled={catalogRetrying}
                onClick={() => void retryCatalog()}
                className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:cursor-wait disabled:opacity-70"
              >
                {catalogRetrying ? (
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />
                ) : null}
                {catalogRetrying ? 'Retrying…' : 'Try again'}
              </button>
            </div>
          )}

          {/* Catalogue-from-bookings hero: a fresh/near-empty venue is offered a
              one-step build of its services rather than per-row setup. */}
          {showReferenceMapping && catalog && servicesLookFresh && bulkType === null && (
            <div className="space-y-3 rounded-xl border border-brand-200 bg-gradient-to-br from-brand-50 to-white p-5">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-700">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.456-2.456L14.25 6l1.035-.259a3.375 3.375 0 002.456-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
                  </svg>
                </span>
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-slate-900">
                    We found {unmatchedServiceCount} {unmatchedServiceCount === 1 ? 'service' : 'services'} in your
                    bookings
                  </h2>
                  <p className="mt-1 text-sm text-slate-600">
                    Set them all up in one step — we&apos;ve filled in a suggested length and price for each from your
                    data. You can tweak anything before creating.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => openBulkPanel('service')}
                className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-700"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                {bulkButtonLabel('service')}
              </button>
            </div>
          )}

          {showReferenceMapping && catalog && (
            <div className="space-y-3 border-t border-slate-100 pt-3">
              <div className="flex flex-wrap gap-2">
                {tabTypes.length === 0 && refs.some((r) => !r.is_resolved) && (
                  <p className="text-xs text-amber-800">
                    Unresolved references could not be grouped by type. Use the list below to skip or map each item.
                  </p>
                )}
                {tabTypes.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                      tab === t ? 'bg-slate-900 text-white' : 'border border-slate-200 text-slate-700'
                    }`}
                    onClick={() => setTab(t)}
                  >
                    {tabLabel(t)}
                  </button>
                ))}
              </div>

              {/* Per-type bulk create. The hero above already covers services for a
                  fresh venue, so suppress the duplicate service button in that case. */}
              {(tab === 'service' || tab === 'staff') &&
                bulkType === null &&
                (tab === 'service' ? unmatchedServiceCount : unmatchedStaffCount) >= 2 &&
                !(tab === 'service' && servicesLookFresh) && (
                  <button
                    type="button"
                    onClick={() => openBulkPanel(tab as 'service' | 'staff')}
                    className="inline-flex items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3.5 py-2 text-xs font-semibold text-brand-700 hover:bg-brand-100"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                    </svg>
                    {bulkButtonLabel(tab as 'service' | 'staff')}
                  </button>
                )}

              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-slate-600">
                  For each item: <strong>Match</strong> it to something you already have on ResNeo,{' '}
                  <strong>Add as new</strong> to set it up now (services ask for length and price), or{' '}
                  <strong>Skip</strong> to leave those bookings out of the import.
                </p>
                {refs.filter((r) => !r.is_resolved && r.ai_suggested_entity_id).length > 1 && (
                  <button
                    type="button"
                    disabled={bulkAccepting}
                    onClick={() => void acceptAllSuggestions()}
                    className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:cursor-wait disabled:opacity-70"
                  >
                    {bulkAccepting ? (
                      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />
                    ) : null}
                    {bulkAccepting
                      ? 'Accepting…'
                      : `Accept all ${refs.filter((r) => !r.is_resolved && r.ai_suggested_entity_id).length} suggestions`}
                  </button>
                )}
              </div>
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {filtered.map((ref) => {
                  const opts = optionsForRef(ref);
                  const suggested = ref.ai_suggested_entity_id;
                  const value = selectByRef[ref.id] ?? suggested ?? '';
                  const fromStaffList = ref.file_id ? fileTypeById[ref.file_id] === 'staff' : false;
                  const createLabel = createButtonLabel(ref);
                  const createOpen = Boolean(createOpenByRef[ref.id]);
                  const draft = createDraftByRef[ref.id] ?? defaultDraftForRef(ref);
                  const isServiceRef = ref.reference_type === 'service';
                  return (
                    <li key={ref.id} className="px-3 py-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="font-medium text-slate-900">{ref.raw_value}</p>
                          <p className="text-xs text-slate-500">
                            {fromStaffList ? 'From your staff list' : `${ref.booking_count ?? 0} booking(s)`}
                            {ref.ai_confidence && suggested ? (
                              <>
                                {' '}
                                · AI suggestion: {ref.ai_suggested_entity_name ?? suggested} ({ref.ai_confidence})
                              </>
                            ) : null}
                          </p>
                        </div>
                        {!ref.is_resolved ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <SearchableEntitySelect
                              options={opts}
                              value={value}
                              onChange={(id) => setSelectByRef((prev) => ({ ...prev, [ref.id]: id }))}
                              ariaLabel={`Match “${ref.raw_value}” to an existing ${tabLabel(ref.reference_type).replace(/s$/, '').toLowerCase() || 'item'}`}
                              disabled={mappingId === ref.id}
                              className="w-52"
                            />
                            <button
                              type="button"
                              disabled={mappingId === ref.id || !value}
                              className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
                              onClick={() => void applyMap(ref)}
                            >
                              {mappingId === ref.id && value ? 'Matching…' : 'Match'}
                            </button>
                            {createLabel && (
                              <button
                                type="button"
                                disabled={mappingId === ref.id}
                                aria-expanded={createOpen}
                                className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                                  createOpen
                                    ? 'border border-emerald-300 bg-emerald-50 text-emerald-800'
                                    : 'border border-emerald-200 text-emerald-700 hover:bg-emerald-50'
                                }`}
                                onClick={() => toggleCreate(ref)}
                              >
                                {createLabel}
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={mappingId === ref.id}
                              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                              onClick={() => void applySkip(ref)}
                            >
                              Skip
                            </button>
                          </div>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700">
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" aria-hidden>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                            </svg>
                            Done
                          </span>
                        )}
                      </div>
                      {/* Lightweight inline quick-create (default for every creatable
                          type). Services get length + price fields and an Advanced link
                          to the full modal; staff just need a name. */}
                      {!ref.is_resolved && createOpen && createLabel && (
                        <div className="mt-3 space-y-3 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
                          <div className="flex flex-wrap items-end gap-3">
                            <label className="flex flex-col gap-0.5">
                              <span className="text-[10px] uppercase tracking-wide text-slate-500">Name</span>
                              <input
                                className="w-56 rounded border border-slate-200 px-2 py-1.5 text-sm"
                                value={draft.name}
                                onChange={(e) =>
                                  setCreateDraftByRef((prev) => ({
                                    ...prev,
                                    [ref.id]: { ...draft, name: e.target.value },
                                  }))
                                }
                              />
                            </label>
                            {isServiceRef && (
                              <>
                                <label className="flex flex-col gap-0.5">
                                  <span className="text-[10px] uppercase tracking-wide text-slate-500">Length (min)</span>
                                  <input
                                    type="number"
                                    inputMode="numeric"
                                    min={1}
                                    className="w-24 rounded border border-slate-200 px-2 py-1.5 text-sm"
                                    placeholder="60"
                                    value={draft.duration}
                                    onChange={(e) =>
                                      setCreateDraftByRef((prev) => ({
                                        ...prev,
                                        [ref.id]: { ...draft, duration: e.target.value },
                                      }))
                                    }
                                  />
                                </label>
                                <label className="flex flex-col gap-0.5">
                                  <span className="text-[10px] uppercase tracking-wide text-slate-500">
                                    Price ({currencySymbol})
                                  </span>
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    className="w-24 rounded border border-slate-200 px-2 py-1.5 text-sm"
                                    placeholder="0.00"
                                    value={draft.price}
                                    onChange={(e) =>
                                      setCreateDraftByRef((prev) => ({
                                        ...prev,
                                        [ref.id]: { ...draft, price: e.target.value },
                                      }))
                                    }
                                  />
                                </label>
                              </>
                            )}
                            <button
                              type="button"
                              disabled={mappingId === ref.id || !draft.name.trim()}
                              onClick={() => void applyCreate(ref)}
                              className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                            >
                              {mappingId === ref.id ? 'Creating…' : createLabel}
                            </button>
                          </div>
                          {isServiceRef ? (
                            <p className="text-[11px] text-slate-600">
                              Creates a bookable service.{' '}
                              <button
                                type="button"
                                disabled={openingModalRefId === ref.id}
                                onClick={() => void openServiceModal(ref)}
                                className="font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800 disabled:opacity-60"
                              >
                                {openingModalRefId === ref.id ? 'Opening…' : 'Advanced setup'}
                              </button>{' '}
                              for online booking, categories and deposits.
                            </p>
                          ) : (
                            <p className="text-[11px] text-slate-600">
                              Creates a bookable calendar with default working hours — fine-tune it later under Staff
                              &amp; Calendars.
                            </p>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
              {filtered.length === 0 && (
                <p className="text-xs text-slate-500">No references in this tab.</p>
              )}
            </div>
          )}
          {resolved && !extract.requiresTableConfirmation && (
            <div className="flex items-start gap-3 rounded-lg border border-green-200 bg-green-50 p-4">
              <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-100 text-green-700">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              </span>
              <div>
                <p className="text-sm font-semibold text-green-900">Everything&apos;s matched up</p>
                <p className="mt-0.5 text-sm text-green-800">
                  Your services and staff are all set for this import. Continue to validation when you&apos;re ready.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {serviceModalRefId &&
        svcContext &&
        (() => {
          const ref = refs.find((r) => r.id === serviceModalRefId);
          if (!ref) return null;
          return (
            <AppointmentServiceModal
              open
              onClose={() => setServiceModalRefId(null)}
              onSaved={(created) => void handleServiceCreated(ref, created)}
              isAdmin
              stripeConnected={svcContext.stripeConnected}
              currencySymbol={svcContext.currencySymbol}
              venueOpeningHours={svcContext.openingHours}
              venueOpeningExceptions={svcContext.openingExceptions}
              calendars={svcContext.calendars}
              initialForm={initialServiceForm(ref)}
              title="Add service"
              saveLabel="Create service"
            />
          );
        })()}

      {bulkType && (
        <BulkCreatePanel
          type={bulkType as 'service' | 'staff'}
          rows={bulkRows}
          running={bulkRunning}
          result={bulkResult}
          selectedCount={selectedBulkCount}
          currencySymbol={currencySymbol}
          staffNoun={staffNoun}
          onPatchRow={patchBulkRow}
          onToggleAll={(selected) => setBulkRows((prev) => prev.map((r) => ({ ...r, selected })))}
          onRun={() => void runBulkCreate()}
          onClose={closeBulkPanel}
        />
      )}

      <div className="flex flex-wrap justify-between gap-3">
        <Link
          href={`/dashboard/import/${sessionId}/review`}
          className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Back
        </Link>
        <Link
          href={`/dashboard/import/${sessionId}/validate`}
          className={`rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 ${
            !resolved ? 'pointer-events-none opacity-50' : ''
          }`}
        >
          Continue to validation
        </Link>
      </div>
    </div>
  );
}

/**
 * Review-and-confirm modal for bulk-creating every unmatched service or team
 * member. Each row is editable (name, and for services a length + price seeded
 * from the booking data) and can be deselected. One click creates them all via
 * the bulk endpoint; the result summary shows how many were created and surfaces
 * any per-row errors so the user can fix and retry just those.
 */
function BulkCreatePanel({
  type,
  rows,
  running,
  result,
  selectedCount,
  currencySymbol,
  staffNoun,
  onPatchRow,
  onToggleAll,
  onRun,
  onClose,
}: {
  type: 'service' | 'staff';
  rows: BulkRow[];
  running: boolean;
  result: BulkResult | null;
  selectedCount: number;
  currencySymbol: string;
  staffNoun: string;
  onPatchRow: (refId: string, patch: Partial<BulkRow>) => void;
  onToggleAll: (selected: boolean) => void;
  onRun: () => void;
  onClose: () => void;
}) {
  const isService = type === 'service';
  const noun = isService ? 'service' : staffNoun;
  const nounPlural = isService ? 'services' : `${staffNoun}s`;
  const allSelected = rows.length > 0 && rows.every((r) => r.selected);
  const succeeded = Boolean(result && result.errors.length === 0);

  return (
    <Dialog
      open
      // Block dismiss (overlay click / escape) while a create is in flight.
      onOpenChange={(next) => {
        if (!next && !running) onClose();
      }}
      size="lg"
      contentClassName="max-w-2xl"
      title={isService ? 'Create your services' : `Add your ${nounPlural}`}
      description={
        succeeded
          ? undefined
          : isService
            ? 'We filled in a suggested length and price from your bookings. Tweak anything, untick to skip, then create them all.'
            : `Review the ${nounPlural} found in your bookings. Untick anyone you don't want, then add them all.`
      }
      bodyClassName="flex min-h-0 flex-col p-0"
      footer={
        succeeded ? (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-700"
            >
              Done
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={running}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onRun}
              disabled={running || selectedCount === 0}
              className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {running ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />
              ) : null}
              {running ? 'Creating…' : `Create ${selectedCount} ${selectedCount === 1 ? noun : nounPlural}`}
            </button>
          </div>
        )
      }
    >
      {succeeded ? (
        <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-green-700">
            <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </span>
          <div>
            <p className="text-lg font-semibold text-slate-900">
              Created {result!.created} {result!.created === 1 ? noun : nounPlural}
            </p>
            <p className="mt-1 text-sm text-slate-600">They&apos;re matched to your bookings and ready to go.</p>
          </div>
        </div>
      ) : (
        <>
          <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-5 py-2">
            <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-700">
              <input
                type="checkbox"
                className="rounded border-slate-300"
                checked={allSelected}
                onChange={(e) => onToggleAll(e.target.checked)}
              />
              Select all
            </label>
            <span className="text-xs text-slate-500">
              {selectedCount} of {rows.length} selected
            </span>
          </div>

          {result && result.errors.length > 0 && (
            <div className="border-b border-amber-100 bg-amber-50 px-5 py-3 text-sm text-amber-900" role="status">
              Created {result.created} of {result.created + result.errors.length}. {result.errors.length}{' '}
              couldn&apos;t be created — fix the highlighted {nounPlural} and try again.
            </div>
          )}

          <ul className="divide-y divide-slate-100">
            {rows.map((row) => {
              const rowError = result?.errors.find((e) => e.reference_id === row.reference_id)?.error;
              return (
                <li
                  key={row.reference_id}
                  className={`px-5 py-3 ${rowError ? 'bg-red-50' : row.selected ? '' : 'opacity-50'}`}
                >
                  <div className="flex flex-wrap items-end gap-3">
                    <input
                      type="checkbox"
                      className="mb-2 rounded border-slate-300"
                      checked={row.selected}
                      aria-label={`Include ${row.name}`}
                      onChange={(e) => onPatchRow(row.reference_id, { selected: e.target.checked })}
                    />
                    <label className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-[10px] uppercase tracking-wide text-slate-500">Name</span>
                      <input
                        className="w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
                        value={row.name}
                        onChange={(e) => onPatchRow(row.reference_id, { name: e.target.value })}
                      />
                    </label>
                    {isService && (
                      <>
                        <label className="flex flex-col gap-0.5">
                          <span className="text-[10px] uppercase tracking-wide text-slate-500">Length (min)</span>
                          <input
                            type="number"
                            inputMode="numeric"
                            min={1}
                            className="w-20 rounded border border-slate-200 px-2 py-1.5 text-sm"
                            placeholder="60"
                            value={row.duration}
                            onChange={(e) => onPatchRow(row.reference_id, { duration: e.target.value })}
                          />
                        </label>
                        <label className="flex flex-col gap-0.5">
                          <span className="text-[10px] uppercase tracking-wide text-slate-500">
                            Price ({currencySymbol})
                          </span>
                          <input
                            type="text"
                            inputMode="decimal"
                            className="w-20 rounded border border-slate-200 px-2 py-1.5 text-sm"
                            placeholder="0.00"
                            value={row.price}
                            onChange={(e) => onPatchRow(row.reference_id, { price: e.target.value })}
                          />
                        </label>
                      </>
                    )}
                  </div>
                  {rowError && <p className="mt-1 text-xs text-red-700">{rowError}</p>}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Dialog>
  );
}
