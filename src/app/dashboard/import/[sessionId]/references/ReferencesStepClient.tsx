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
  requiresTableConfirmation?: boolean;
  bookingModel?: string;
  mode?: string;
};

type BookingRef = {
  id: string;
  reference_type: string;
  raw_value: string;
  booking_count?: number;
  is_resolved: boolean;
  ai_suggested_entity_id?: string | null;
  ai_suggested_entity_name?: string | null;
  ai_confidence?: string | null;
  resolution_action?: string | null;
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
  const [selectByRef, setSelectByRef] = useState<Record<string, string>>({});

  const loadSession = useCallback(async () => {
    const res = await fetch(`/api/import/sessions/${sessionId}`);
    const data = await readResponseJson<{
      session?: { references_resolved?: boolean };
      booking_references?: BookingRef[];
      error?: string;
    }>(res);
    if (!res.ok) throw new Error(data.error ?? 'Failed to load session');
    setRefs((data.booking_references ?? []) as BookingRef[]);
    setResolvedFlag(data.session?.references_resolved === true);
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
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
    setLoading(false);
  }, [sessionId, loadSession]);

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

  async function applyMap(ref: BookingRef) {
    const pick = selectByRef[ref.id] ?? ref.ai_suggested_entity_id ?? '';
    if (!pick) return;
    setMappingId(ref.id);
    setError(null);
    try {
      let resolved_entity_type:
        | 'service_item'
        | 'appointment_service'
        | 'unified_calendar'
        | 'practitioner'
        | 'event_session'
        | 'class_instance'
        | undefined;

      if (ref.reference_type === 'service') {
        if (catalog?.bookingModel === 'practitioner_appointment') {
          resolved_entity_type = 'appointment_service';
        } else {
          resolved_entity_type = 'service_item';
        }
      } else if (ref.reference_type === 'staff') {
        if (catalog?.bookingModel === 'practitioner_appointment') {
          resolved_entity_type = 'practitioner';
        } else {
          resolved_entity_type = 'unified_calendar';
        }
      } else if (ref.reference_type === 'event') {
        resolved_entity_type = 'event_session';
      } else if (ref.reference_type === 'class') {
        resolved_entity_type = 'class_instance';
      } else if (ref.reference_type === 'resource') {
        resolved_entity_type = 'unified_calendar';
      }

      const res = await fetch(`/api/import/sessions/${sessionId}/references/${ref.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resolution_action: 'map',
          resolved_entity_id: pick,
          resolved_entity_type,
        }),
      });
      const data = await readResponseJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(data.error ?? 'Could not save');
      await loadSession();
      const ses = await fetch(`/api/import/sessions/${sessionId}`);
      const j = await readResponseJson<{ session?: { references_resolved?: boolean } }>(ses);
      setResolvedFlag(j.session?.references_resolved === true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
    setMappingId(null);
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
      await loadSession();
      const ses = await fetch(`/api/import/sessions/${sessionId}`);
      const j = await readResponseJson<{ session?: { references_resolved?: boolean } }>(ses);
      setResolvedFlag(j.session?.references_resolved === true);
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
        <h1 className="text-xl font-semibold text-slate-900">Match booking references</h1>
        <p className="mt-1 text-sm text-slate-600">
          Future bookings are checked against your venue&apos;s booking model. Complete this step before validation.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">{error}</div>
      )}

      {loading && (
        <p className="text-sm text-slate-600" role="status">
          Analysing booking file…
        </p>
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
              <p className="text-xs text-slate-600">
                Map each external label to an existing catalogue entry, or skip to exclude those booking rows from
                import.
              </p>
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {filtered.map((ref) => {
                  const opts = optionsForRef(ref);
                  const suggested = ref.ai_suggested_entity_id;
                  const value = selectByRef[ref.id] ?? suggested ?? '';
                  return (
                    <li key={ref.id} className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="font-medium text-slate-900">{ref.raw_value}</p>
                        <p className="text-xs text-slate-500">
                          {ref.booking_count ?? 0} booking(s)
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
