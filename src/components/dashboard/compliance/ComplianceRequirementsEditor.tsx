'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import { Dialog } from '@/components/ui/primitives/Dialog';
import { Pill } from '@/components/ui/dashboard/Pill';
import {
  CATEGORY_LABELS,
  ENFORCEMENT_OPTIONS,
  ENFORCEMENT_DESCRIPTIONS,
  ONLINE_COLLECTION_OPTIONS,
  ONLINE_COLLECTION_DESCRIPTIONS,
  complianceJsonFetcher,
  type ComplianceTypeSummary,
  type RequirementRowData,
} from '@/components/dashboard/compliance/shared';

/** A type is offered online (inline / email link) only when clients can complete it. */
function typeSupportsClientOnline(captureMethods: string[] | undefined): boolean {
  // Unknown (e.g. an archived type no longer in the active list) defaults to showing the
  // control; the booking flow and auto-send gate on the real capture methods regardless.
  return (captureMethods ?? ['client_online']).includes('client_online');
}

/**
 * Inline service-compliance-requirements editor (spec §3.6 / §11.5). Shared by
 * the service editor and the Settings → Compliance per-service drill-in. Hidden
 * entirely when the compliance feature is off for the venue.
 */
export function ComplianceRequirementsEditor({
  appointmentServiceId,
  complianceEnabled,
}: {
  appointmentServiceId: string;
  complianceEnabled: boolean;
}) {
  const reqUrl = `/api/venue/compliance/requirements?appointment_service_id=${encodeURIComponent(appointmentServiceId)}`;
  const {
    data: reqData,
    mutate: mutateReqs,
    isLoading: reqLoading,
  } = useSWR<{ requirements: RequirementRowData[] }>(
    complianceEnabled ? reqUrl : null,
    complianceJsonFetcher,
  );
  const { data: typesData } = useSWR<{ types: ComplianceTypeSummary[] }>(
    complianceEnabled ? '/api/venue/compliance/types' : null,
    complianceJsonFetcher,
  );

  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const requirements = reqData?.requirements ?? [];
  const allTypes = useMemo(() => (typesData?.types ?? []).filter((t) => t.is_active), [typesData]);
  const assignedTypeIds = new Set(requirements.map((r) => r.compliance_type_id));
  const availableTypes = allTypes.filter((t) => !assignedTypeIds.has(t.id));
  const captureMethodsByType = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const t of typesData?.types ?? []) m.set(t.id, t.capture_methods ?? []);
    return m;
  }, [typesData]);

  if (!complianceEnabled) return null;

  async function patchRequirement(reqId: string, body: Record<string, unknown>) {
    setBusyId(reqId);
    setError(null);
    try {
      const res = await fetch(`/api/venue/compliance/requirements/${reqId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setError(b.error ?? 'Could not update requirement.');
        return;
      }
      await mutateReqs();
    } finally {
      setBusyId(null);
    }
  }

  const updateEnforcement = (reqId: string, enforcement: string) => patchRequirement(reqId, { enforcement });
  const updateCollection = (reqId: string, online_collection: string) =>
    patchRequirement(reqId, { online_collection });
  const updateLockPeriod = (reqId: string, lock_period_hours: number | null) =>
    patchRequirement(reqId, { lock_period_hours });

  /** Validate + persist a lead-time input on blur, skipping no-ops and invalid values. */
  function commitLeadTime(r: RequirementRowData, raw: string) {
    const trimmed = raw.trim();
    const current = r.lock_period_hours ?? null;
    let next: number | null;
    if (trimmed === '') {
      next = null;
    } else {
      const n = Number(trimmed);
      if (!Number.isFinite(n)) return;
      next = Math.max(0, Math.min(8760, Math.round(n)));
    }
    if (next === current) return;
    void updateLockPeriod(r.id, next);
  }

  async function removeRequirement(reqId: string) {
    setBusyId(reqId);
    setError(null);
    try {
      const res = await fetch(`/api/venue/compliance/requirements/${reqId}`, { method: 'DELETE' });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setError(b.error ?? 'Could not remove requirement.');
        return;
      }
      await mutateReqs();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <SectionCard>
      <SectionCard.Header
        eyebrow="Compliance"
        title="Compliance requirements"
        description="Records this service requires before a booking. Missing or expired records warn or block at booking time."
        right={
          allTypes.length > 0 ? (
            <button
              type="button"
              onClick={() => setAdding(true)}
              disabled={availableTypes.length === 0}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Add requirement
            </button>
          ) : undefined
        }
      />
      <SectionCard.Body>
        {error && (
          <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 p-2 text-sm text-rose-700">
            {error}
          </div>
        )}

        {allTypes.length === 0 && !reqLoading ? (
          <p className="text-sm text-slate-500">
            No compliance types set up yet.{' '}
            <a href="/dashboard/settings?tab=compliance&sub=types" className="text-brand-600 underline">
              Create one in Settings → Compliance
            </a>
            .
          </p>
        ) : requirements.length === 0 ? (
          <p className="text-sm text-slate-500">
            This service has no compliance requirements. Add one to warn or block bookings without a valid record.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {requirements.map((r) => (
              <li key={r.id} className="py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-800">
                      {r.compliance_type_name}
                      {!r.compliance_type_is_active && (
                        <span className="ml-2 text-xs font-normal text-amber-600">(archived)</span>
                      )}
                    </p>
                    <Pill variant="neutral" size="sm" className="mt-1">
                      {CATEGORY_LABELS[r.compliance_type_category] ?? r.compliance_type_category}
                    </Pill>
                  </div>
                  <label className="sr-only" htmlFor={`enforcement-${r.id}`}>
                    When this requirement is unmet
                  </label>
                  <select
                    id={`enforcement-${r.id}`}
                    value={r.enforcement}
                    disabled={busyId === r.id}
                    onChange={(e) => updateEnforcement(r.id, e.target.value)}
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700"
                  >
                    {ENFORCEMENT_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => removeRequirement(r.id)}
                    disabled={busyId === r.id}
                    className="text-sm font-medium text-rose-600 hover:text-rose-700 disabled:opacity-50"
                  >
                    Remove
                  </button>
                </div>
                {ENFORCEMENT_DESCRIPTIONS[r.enforcement] && (
                  <p className="mt-1.5 text-xs text-slate-500">{ENFORCEMENT_DESCRIPTIONS[r.enforcement]}</p>
                )}
                <div className="mt-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="text-xs font-medium text-slate-600" htmlFor={`lead-${r.id}`}>
                      Lead time:
                    </label>
                    <input
                      id={`lead-${r.id}`}
                      type="number"
                      min={0}
                      max={8760}
                      defaultValue={r.lock_period_hours ?? ''}
                      disabled={busyId === r.id}
                      onBlur={(e) => commitLeadTime(r, e.target.value)}
                      placeholder="None"
                      className="w-20 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                    />
                    <span className="text-xs text-slate-500">hours before the appointment</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    Require the record to be completed at least this many hours before the visit (for example 48 for
                    a patch test). Leave blank for no lead time.
                  </p>
                </div>
                {typeSupportsClientOnline(captureMethodsByType.get(r.compliance_type_id)) ? (
                  <div className="mt-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-medium text-slate-600">Online booking:</span>
                      <label className="sr-only" htmlFor={`collection-${r.id}`}>
                        Where the client completes this online
                      </label>
                      <select
                        id={`collection-${r.id}`}
                        value={r.online_collection}
                        disabled={busyId === r.id}
                        onChange={(e) => updateCollection(r.id, e.target.value)}
                        className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                      >
                        {ONLINE_COLLECTION_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    {ONLINE_COLLECTION_DESCRIPTIONS[r.online_collection] && (
                      <p className="mt-1 text-xs text-slate-500">
                        {ONLINE_COLLECTION_DESCRIPTIONS[r.online_collection]}
                      </p>
                    )}
                    {(r.enforcement === 'block_online' || r.enforcement === 'block_all') &&
                      r.online_collection === 'none' && (
                        <p className="mt-1 text-xs text-amber-600">
                          This blocks online booking but isn’t offered online, so clients can’t complete it
                          themselves. Choose how it’s collected online above, or add a message (on the type) telling
                          them what to do.
                        </p>
                      )}
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-slate-500">
                    Your team completes this in venue. It is not shown to clients online.
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </SectionCard.Body>

      <AddRequirementDialog
        open={adding}
        onOpenChange={setAdding}
        serviceId={appointmentServiceId}
        availableTypes={availableTypes}
        onAdded={() => mutateReqs()}
      />
    </SectionCard>
  );
}

function AddRequirementDialog({
  open,
  onOpenChange,
  serviceId,
  availableTypes,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serviceId: string;
  availableTypes: ComplianceTypeSummary[];
  onAdded: () => void;
}) {
  const [typeId, setTypeId] = useState('');
  const [enforcement, setEnforcement] = useState('warn_staff');
  const [onlineCollection, setOnlineCollection] = useState('confirmation_link');
  const [leadTime, setLeadTime] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedType = availableTypes.find((t) => t.id === typeId);
  const supportsOnline = Boolean(selectedType) && typeSupportsClientOnline(selectedType?.capture_methods);

  async function submit() {
    if (!typeId) {
      setError('Choose a compliance type.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/venue/compliance/requirements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_id: serviceId,
          compliance_type_id: typeId,
          enforcement,
          online_collection: supportsOnline ? onlineCollection : 'none',
          lock_period_hours:
            leadTime.trim() === '' ? null : Math.max(0, Math.min(8760, Math.round(Number(leadTime)))),
        }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setError(b.error ?? 'Could not add requirement.');
        return;
      }
      onAdded();
      setTypeId('');
      setEnforcement('warn_staff');
      setOnlineCollection('confirmation_link');
      setLeadTime('');
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add compliance requirement"
      description="Require a compliance record for this service."
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
          >
            {submitting ? 'Adding…' : 'Add requirement'}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-2 text-sm text-rose-700">{error}</div>
        )}
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Compliance type</label>
          <select
            value={typeId}
            onChange={(e) => setTypeId(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
          >
            <option value="">Select a type…</option>
            {availableTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">When unmet</label>
          <select
            value={enforcement}
            onChange={(e) => setEnforcement(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
          >
            {ENFORCEMENT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {ENFORCEMENT_DESCRIPTIONS[enforcement] && (
            <p className="mt-1.5 text-xs text-slate-500">{ENFORCEMENT_DESCRIPTIONS[enforcement]}</p>
          )}
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Lead time (optional)</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={8760}
              value={leadTime}
              onChange={(e) => setLeadTime(e.target.value)}
              placeholder="None"
              className="w-24 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
            />
            <span className="text-sm text-slate-500">hours before the appointment</span>
          </div>
          <p className="mt-1.5 text-xs text-slate-500">
            Require the record to be on file at least this many hours before the visit, for example 48 for a patch
            test.
          </p>
        </div>
        {supportsOnline && (
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Online booking</label>
            <select
              value={onlineCollection}
              onChange={(e) => setOnlineCollection(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
            >
              {ONLINE_COLLECTION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            {ONLINE_COLLECTION_DESCRIPTIONS[onlineCollection] && (
              <p className="mt-1.5 text-xs text-slate-500">{ONLINE_COLLECTION_DESCRIPTIONS[onlineCollection]}</p>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}
