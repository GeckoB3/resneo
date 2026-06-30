'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Dialog } from '@/components/ui/primitives/Dialog';
import { Pill } from '@/components/ui/dashboard/Pill';
import {
  complianceJsonFetcher,
  formatComplianceDate,
  joinedTypeName,
  recordStatusPill,
  type ComplianceRecordRow,
} from '@/components/dashboard/compliance/shared';
import type { ComplianceField, ComplianceFormSchema } from '@/lib/compliance/form-schema';

interface RecordViewResponse {
  record: ComplianceRecordRow & {
    responses: Record<string, unknown>;
    capture_channel: string;
    voided_reason?: string | null;
  };
  version: { version_number: number; form_schema: ComplianceFormSchema } | null;
}

/** Friendly labels for a record's stored `result` value (audit Low: no raw tokens in the UI). */
const RESULT_LABELS: Record<string, string> = {
  pass: 'Pass',
  fail: 'Fail',
  inconclusive: 'Inconclusive',
  completed: 'Completed',
  signed: 'Signed',
};

function renderAnswer(field: ComplianceField, value: unknown): string {
  if (value == null || value === '') return '–';
  switch (field.type) {
    case 'signature': {
      const v = value as { method?: string };
      return v.method === 'typed' ? `Signed (typed)` : 'Signature on file';
    }
    case 'file': {
      const v = value as { file_name?: string };
      return v.file_name ?? 'File uploaded';
    }
    case 'multiselect':
      return Array.isArray(value) ? (value as string[]).join(', ') : String(value);
    case 'select': {
      const opt = field.options.find((o) => o.value === value);
      return opt?.label ?? String(value);
    }
    case 'date':
      // Stored as YYYY-MM-DD — show as DD/MM/YYYY.
      return formatComplianceDate(String(value));
    default:
      return String(value);
  }
}

/**
 * Opens a captured signature/file via a short-lived signed URL from the venue file route
 * (audit H2). The bucket is private, so we fetch the URL on demand and open it in a new tab.
 */
function RecordArtifactLink({ recordId, fieldId, label }: { recordId: string; fieldId: string; label: string }) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function open() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(
        `/api/venue/compliance/records/${recordId}/file?field=${encodeURIComponent(fieldId)}`,
      );
      const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !body.url) {
        setErr(body.error ?? 'Could not open the file.');
        return;
      }
      window.open(body.url, '_blank', 'noopener,noreferrer');
    } finally {
      setLoading(false);
    }
  }
  return (
    <span className="text-sm">
      <button
        type="button"
        onClick={open}
        disabled={loading}
        className="font-medium text-brand-600 underline hover:text-brand-700 disabled:opacity-50"
      >
        {loading ? 'Opening…' : label}
      </button>
      {err && <span className="ml-2 text-xs text-rose-600">{err}</span>}
    </span>
  );
}

export function ComplianceRecordViewDialog({
  open,
  onOpenChange,
  recordId,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recordId: string | null;
  onChanged: () => void;
}) {
  const { data, isLoading, mutate } = useSWR<RecordViewResponse>(
    open && recordId ? `/api/venue/compliance/records/${recordId}` : null,
    complianceJsonFetcher,
  );
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState('');
  const [showVoid, setShowVoid] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<string | null>(null);

  const record = data?.record;
  const schema = data?.version?.form_schema ?? null;
  const isVoided = Boolean(record?.voided_at);
  // A pass/fail record with no result is awaiting a staff decision (e.g. a client-submitted
  // patch test): it does not satisfy a booking until pass/fail is recorded (audit H4).
  const recordTypeJoin = record?.compliance_types;
  const recordResultType = (Array.isArray(recordTypeJoin) ? recordTypeJoin[0] : recordTypeJoin) as
    | { result_type?: string }
    | undefined;
  const needsDecision = Boolean(record) && !isVoided && recordResultType?.result_type === 'pass_fail' && record!.result == null;

  async function recordDecision(result: 'pass' | 'fail' | 'inconclusive') {
    if (!recordId) return;
    setDeciding(result);
    setError(null);
    try {
      const res = await fetch(`/api/venue/compliance/records/${recordId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ result }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? 'Could not record the decision.');
        return;
      }
      await mutate();
      onChanged();
    } finally {
      setDeciding(null);
    }
  }

  async function voidRecord() {
    if (!recordId || reason.trim().length === 0) {
      setError('A reason is required.');
      return;
    }
    setVoiding(true);
    setError(null);
    try {
      const res = await fetch(`/api/venue/compliance/records/${recordId}/void`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? 'Could not void the record.');
        return;
      }
      await mutate();
      onChanged();
      setShowVoid(false);
      setReason('');
    } finally {
      setVoiding(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Compliance record" size="lg">
      {isLoading && <p className="text-sm text-slate-500">Loading…</p>}
      {!isLoading && !record && <p className="text-sm text-rose-600">Record not found.</p>}
      {record && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm font-semibold text-slate-800">{joinedTypeName(record.compliance_types)}</p>
            {(() => {
              const p = recordStatusPill(record);
              return (
                <Pill variant={p.variant} size="sm" dot>
                  {p.label}
                </Pill>
              );
            })()}
            {record.result && (
              <Pill variant="neutral" size="sm">
                {RESULT_LABELS[record.result] ?? record.result}
              </Pill>
            )}
          </div>

          {needsDecision && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm font-medium text-amber-900">Needs a pass or fail decision</p>
              <p className="mt-0.5 text-xs text-amber-800">
                The client completed this form. Record the result so it counts towards their booking.
              </p>
              {error && (
                <p role="alert" className="mt-1 text-sm text-rose-600">
                  {error}
                </p>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={Boolean(deciding)}
                  onClick={() => recordDecision('pass')}
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {deciding === 'pass' ? 'Saving…' : 'Pass'}
                </button>
                <button
                  type="button"
                  disabled={Boolean(deciding)}
                  onClick={() => recordDecision('fail')}
                  className="rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {deciding === 'fail' ? 'Saving…' : 'Fail'}
                </button>
                <button
                  type="button"
                  disabled={Boolean(deciding)}
                  onClick={() => recordDecision('inconclusive')}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 disabled:opacity-60"
                >
                  {deciding === 'inconclusive' ? 'Saving…' : 'Inconclusive'}
                </button>
              </div>
            </div>
          )}

          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-400">Captured</dt>
              <dd className="text-slate-700">{formatComplianceDate(record.captured_at)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-400">Expires</dt>
              <dd className="text-slate-700">{record.expires_at ? formatComplianceDate(record.expires_at) : 'No expiry'}</dd>
            </div>
          </dl>

          {isVoided && record.voided_reason && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
              <span className="font-medium">Voided:</span> {record.voided_reason}
            </div>
          )}

          <div className="rounded-lg border border-slate-200 divide-y divide-slate-100">
            {(schema?.fields ?? []).map((field) => {
              const value = record.responses?.[field.id];
              const storagePath =
                value && typeof value === 'object' ? (value as { storage_path?: unknown }).storage_path : null;
              const hasArtifact = typeof storagePath === 'string' && storagePath.length > 0;
              const fileName =
                value && typeof value === 'object' ? (value as { file_name?: string }).file_name : undefined;
              return (
                <div key={field.id} className="flex flex-col gap-0.5 px-3 py-2">
                  <span className="text-xs font-medium text-slate-500">{field.label}</span>
                  {field.type === 'signature' && hasArtifact ? (
                    <RecordArtifactLink recordId={record.id} fieldId={field.id} label="View signature" />
                  ) : field.type === 'file' && hasArtifact ? (
                    <RecordArtifactLink
                      recordId={record.id}
                      fieldId={field.id}
                      label={`Download ${fileName ?? 'file'}`}
                    />
                  ) : (
                    <span className="text-sm text-slate-800">{renderAnswer(field, value)}</span>
                  )}
                </div>
              );
            })}
          </div>

          {!isVoided && (
            <div className="border-t border-slate-100 pt-3">
              {showVoid ? (
                <div className="space-y-2">
                  {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
                  <p className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
                    Voiding is permanent and cannot be undone. The record stays in the audit trail but no longer counts towards compliance.
                  </p>
                  <label className="block text-sm font-medium text-slate-700">Reason for voiding</label>
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    maxLength={500}
                    rows={2}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowVoid(false)}
                      className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={voidRecord}
                      disabled={voiding}
                      className="rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
                    >
                      {voiding ? 'Voiding…' : 'Void record'}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowVoid(true)}
                  className="text-sm font-medium text-rose-600 hover:text-rose-700"
                >
                  Void this record
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
