'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { readResponseJson } from '@/lib/api/read-response-json';

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
      const catRes = await fetch(`/api/import/sessions/${sessionId}/reference-catalog`);
      const cat = await readResponseJson<Catalog & { error?: string }>(catRes);
      if (catRes.ok) setCatalog(cat);
      await loadDefaults();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
    setLoading(false);
  }, [sessionId, loadSession, loadDefaults]);

  useEffect(() => {
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
      duration: d?.suggested_duration_minutes ? String(d.suggested_duration_minutes) : '',
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Set up services &amp; staff</h1>
        <p className="mt-1 text-sm text-slate-600">
          The services and staff named in your files are matched to what you already have on Resneo. Anything we
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
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-slate-600">
                  For each item: <strong>Map</strong> it to something you already have on Resneo,{' '}
                  <strong>Add as new</strong> to set it up now (services ask for duration and price), or{' '}
                  <strong>Skip</strong> to leave those booking rows out of the import.
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
                  const refDefault = defaultsByRef[ref.id];
                  const durationMissing = ref.reference_type === 'service' && !draft.duration.trim();
                  const priceMissing = ref.reference_type === 'service' && !draft.price.trim();
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
                            <select
                              className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                              value={value}
                              onChange={(e) =>
                                setSelectByRef((prev) => ({
                                  ...prev,
                                  [ref.id]: e.target.value,
                                }))
                              }
                            >
                              <option value="">Choose…</option>
                              {opts.map((o) => (
                                <option key={o.id} value={o.id}>
                                  {o.name}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              disabled={mappingId === ref.id || !value}
                              className="rounded-lg bg-brand-600 px-2 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                              onClick={() => void applyMap(ref)}
                            >
                              Map
                            </button>
                            {createLabel && (
                              <button
                                type="button"
                                disabled={mappingId === ref.id}
                                className={`rounded-lg px-2 py-1.5 text-xs font-semibold ${
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
                              className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-medium text-slate-700"
                              onClick={() => void applySkip(ref)}
                            >
                              Skip
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs font-medium text-green-700">Done</span>
                        )}
                      </div>
                      {!ref.is_resolved && createOpen && (
                        <div className="mt-3 space-y-2 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
                          {ref.reference_type === 'service' ? (
                            <>
                              <p className="text-xs font-semibold text-slate-800">
                                Set up this service
                                {refDefault && (refDefault.suggested_duration_minutes || refDefault.suggested_price_pence != null) ? (
                                  <span className="ml-1 font-normal text-slate-600">
                                    — we pre-filled what we found in your booking data
                                  </span>
                                ) : null}
                              </p>
                              <div className="flex flex-wrap items-end gap-3">
                                <label className="flex flex-col gap-0.5">
                                  <span className="text-[10px] uppercase tracking-wide text-slate-500">Service name</span>
                                  <input
                                    className="w-56 rounded border border-slate-200 px-2 py-1 text-xs"
                                    value={draft.name}
                                    onChange={(e) =>
                                      setCreateDraftByRef((prev) => ({
                                        ...prev,
                                        [ref.id]: { ...draft, name: e.target.value },
                                      }))
                                    }
                                  />
                                </label>
                                <label className="flex flex-col gap-0.5">
                                  <span className="text-[10px] uppercase tracking-wide text-slate-500">
                                    Duration (minutes)
                                  </span>
                                  <input
                                    className={`w-28 rounded border px-2 py-1 text-xs ${
                                      durationMissing ? 'border-amber-400 bg-amber-50' : 'border-slate-200'
                                    }`}
                                    inputMode="numeric"
                                    placeholder="e.g. 45"
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
                                  <span className="text-[10px] uppercase tracking-wide text-slate-500">Price (£)</span>
                                  <input
                                    className={`w-28 rounded border px-2 py-1 text-xs ${
                                      priceMissing ? 'border-amber-400 bg-amber-50' : 'border-slate-200'
                                    }`}
                                    inputMode="decimal"
                                    placeholder="e.g. 28.00"
                                    value={draft.price}
                                    onChange={(e) =>
                                      setCreateDraftByRef((prev) => ({
                                        ...prev,
                                        [ref.id]: { ...draft, price: e.target.value },
                                      }))
                                    }
                                  />
                                </label>
                                <button
                                  type="button"
                                  disabled={mappingId === ref.id || durationMissing || !draft.name.trim()}
                                  onClick={() => void applyCreate(ref)}
                                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                                >
                                  {mappingId === ref.id ? 'Creating…' : 'Create service'}
                                </button>
                              </div>
                              {(durationMissing || priceMissing) && (
                                <p className="text-[11px] text-amber-800">
                                  {durationMissing
                                    ? 'Your file didn’t include a duration for this service — set one to continue. '
                                    : ''}
                                  {priceMissing
                                    ? 'No price found — you can leave it blank and add it later under Services.'
                                    : ''}
                                </p>
                              )}
                            </>
                          ) : (
                            <div className="flex flex-wrap items-end gap-3">
                              <label className="flex flex-col gap-0.5">
                                <span className="text-[10px] uppercase tracking-wide text-slate-500">Name</span>
                                <input
                                  className="w-56 rounded border border-slate-200 px-2 py-1 text-xs"
                                  value={draft.name}
                                  onChange={(e) =>
                                    setCreateDraftByRef((prev) => ({
                                      ...prev,
                                      [ref.id]: { ...draft, name: e.target.value },
                                    }))
                                  }
                                />
                              </label>
                              <button
                                type="button"
                                disabled={mappingId === ref.id || !draft.name.trim()}
                                onClick={() => void applyCreate(ref)}
                                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                              >
                                {mappingId === ref.id ? 'Creating…' : createLabel}
                              </button>
                              <p className="basis-full text-[11px] text-slate-600">
                                Creates a bookable calendar with default working hours — fine-tune it later under
                                Staff &amp; Calendars.
                              </p>
                            </div>
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
            <p className="text-green-800">References are satisfied for this session.</p>
          )}
        </div>
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
