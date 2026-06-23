'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Dialog } from '@/components/ui/primitives/Dialog';
import { ImportRowPreviewDialog } from '@/components/import/ImportRowPreviewDialog';
import { useImportTerminology } from '@/components/import/ImportTerminologyContext';
import { readResponseJson } from '@/lib/api/read-response-json';
import { SEND_IMPORT_REMINDERS_SESSION_KEY } from '@/lib/import/booking-import-comms';

type Issue = {
  id: string;
  file_id: string;
  row_number: number;
  severity: string;
  issue_type: string;
  message: string;
  user_decision: string | null;
};

type ValidationSummary = {
  total_data_rows?: number;
  rows_with_blocking_errors?: number;
  rows_ready?: number;
  rows_with_existing_client_warning?: number;
  error_issue_count?: number;
  warning_issue_count?: number;
  staff_files_skipped?: number;
  booking_defaults_blocked?: boolean;
};

type SessionPayload = {
  status?: string;
  has_booking_file?: boolean;
  session_settings?: {
    validation_summary?: ValidationSummary;
    send_import_reminders?: boolean;
  } | null;
  validation_job_id?: string | null;
  validation_job_status?: string | null;
  validation_job_error?: string | null;
};

type ImportFile = { id: string; filename: string };

type LoadResult = {
  session?: SessionPayload;
  issues?: Issue[];
  files?: ImportFile[];
};

async function fetchSession(sessionId: string): Promise<LoadResult> {
  const res = await fetch(`/api/import/sessions/${sessionId}`);
  const data = await readResponseJson<LoadResult & { error?: string }>(res);
  if (!res.ok) throw new Error(data.error ?? 'Failed to load session');
  return data;
}

type ValidationJobPoll = {
  validation_job_id: string | null;
  validation_job_status: string | null;
  validation_job_error: string | null;
  status: string;
  validation_rows_processed: number;
  validation_rows_total: number;
  percent: number;
};

async function fetchValidationJob(sessionId: string): Promise<ValidationJobPoll> {
  const res = await fetch(`/api/import/sessions/${sessionId}/validate`);
  const data = await readResponseJson<ValidationJobPoll & { error?: string }>(res);
  if (!res.ok) throw new Error(data.error ?? 'Failed to load validation status');
  return data;
}

function countsFromIssues(issues: Issue[]) {
  return {
    errorCount: issues.filter((i) => i.severity === 'error').length,
    warningCount: issues.filter((i) => i.severity === 'warning').length,
  };
}

function groupByIssueType(issues: Issue[]) {
  const m = new Map<string, Issue[]>();
  for (const i of issues) {
    const list = m.get(i.issue_type) ?? [];
    list.push(i);
    m.set(i.issue_type, list);
  }
  return m;
}

export function ValidateStepClient({ sessionId }: { sessionId: string }) {
  const { clientLabel } = useImportTerminology();
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(false);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [filesById, setFilesById] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState<ValidationSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const [counts, setCounts] = useState<{ errorCount: number; warningCount: number } | null>(null);
  const [dateChoice, setDateChoice] = useState<'dd/MM/yyyy' | 'MM/dd/yyyy' | ''>('');
  const [validationScan, setValidationScan] = useState<{
    processed: number;
    total: number;
    percent: number;
  } | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const [preview, setPreview] = useState<{ fileId: string; row: number; filename: string } | null>(null);
  const [patchingId, setPatchingId] = useState<string | null>(null);
  const [hasBookingFile, setHasBookingFile] = useState(false);
  const [sendImportReminders, setSendImportReminders] = useState(true);
  const [savingImportCommsPref, setSavingImportCommsPref] = useState(false);
  const [plan, setPlan] = useState<{ headline: string; narrative: string } | null>(null);
  const [showApprove, setShowApprove] = useState(false);

  /** Stage 5 Import Plan: plain-English summary fetched once validation has settled. */
  const loadPlan = useCallback(async () => {
    try {
      const res = await fetch(`/api/import/sessions/${sessionId}/plan`);
      if (!res.ok) return;
      const j = await readResponseJson<{ headline?: string; narrative?: string }>(res);
      if (j.headline && j.narrative) setPlan({ headline: j.headline, narrative: j.narrative });
    } catch {
      /* plan is decorative; never block validation on it */
    }
  }, [sessionId]);

  const clearPoll = useCallback(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  const applyLoaded = useCallback((data: LoadResult) => {
    setIssues(data.issues ?? []);
    setCounts(data.issues?.length ? countsFromIssues(data.issues) : null);
    const s = data.session?.session_settings?.validation_summary ?? null;
    setSummary(s ?? null);
    setHasBookingFile(Boolean(data.session?.has_booking_file));
    const rawReminders = data.session?.session_settings?.[SEND_IMPORT_REMINDERS_SESSION_KEY];
    setSendImportReminders(rawReminders !== false);
    const map: Record<string, string> = {};
    for (const f of data.files ?? []) {
      map[f.id] = f.filename;
    }
    setFilesById(map);
  }, []);

  const persistSendImportReminders = useCallback(
    async (enabled: boolean) => {
      setSavingImportCommsPref(true);
      try {
        const res = await fetch(`/api/import/sessions/${sessionId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_settings: { [SEND_IMPORT_REMINDERS_SESSION_KEY]: enabled },
          }),
        });
        const data = await readResponseJson<{ error?: string }>(res);
        if (!res.ok) throw new Error(data.error ?? 'Failed to save reminder preference');
      } finally {
        setSavingImportCommsPref(false);
      }
    },
    [sessionId],
  );

  const waitForValidation = useCallback(
    async () => {
      setPolling(true);
      setJobError(null);
      setValidationScan(null);

      const pollOnce = async () => {
        const lite = await fetchValidationJob(sessionId);
        const st = lite.validation_job_status;
        setValidationScan({
          processed: lite.validation_rows_processed,
          total: lite.validation_rows_total,
          percent: lite.percent,
        });

        if (st === 'failed') {
          clearPoll();
          setPolling(false);
          setLoading(false);
          setJobError(lite.validation_job_error ?? 'Validation failed');
          const data = await fetchSession(sessionId);
          applyLoaded(data);
          setValidationScan(null);
          return true;
        }
        if (st === 'complete') {
          clearPoll();
          setPolling(false);
          setLoading(false);
          const data = await fetchSession(sessionId);
          applyLoaded(data);
          setValidationScan(null);
          void loadPlan();
          return true;
        }
        return false;
      };

      if (await pollOnce()) return;

      pollTimer.current = setInterval(() => {
        void (async () => {
          try {
            await pollOnce();
          } catch (e) {
            clearPoll();
            setPolling(false);
            setLoading(false);
            setValidationScan(null);
            setError(e instanceof Error ? e.message : 'Polling failed');
          }
        })();
      }, 900);
    },
    [applyLoaded, clearPoll, loadPlan, sessionId],
  );

  useEffect(() => {
    return () => clearPoll();
  }, [clearPoll]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);
      setError(null);
      setJobError(null);
      try {
        const data = await fetchSession(sessionId);
        if (cancelled) return;

        const st = data.session?.validation_job_status;
        const sessStatus = data.session?.status;

        if (st === 'queued' || st === 'running') {
          applyLoaded({ ...data, issues: [] });
          setCounts(null);
          await waitForValidation();
          return;
        }

        if (st === 'failed') {
          setJobError(data.session?.validation_job_error ?? 'Validation failed');
          applyLoaded(data);
          setLoading(false);
          return;
        }

        if (st === 'complete' && sessStatus === 'ready') {
          applyLoaded(data);
          setLoading(false);
          void loadPlan();
          return;
        }

        const res = await fetch(`/api/import/sessions/${sessionId}/validate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        const payload = await readResponseJson<{
          jobId?: string;
          error?: string;
          message?: string;
        }>(res);
        if (!res.ok) {
          throw new Error(payload.message ?? payload.error ?? 'Validation failed');
        }
        await waitForValidation();
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Validation failed');
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      clearPoll();
    };
  }, [sessionId, applyLoaded, waitForValidation, clearPoll, loadPlan]);

  async function runValidation(extra?: { ambiguous_date_format?: 'dd/MM/yyyy' | 'MM/dd/yyyy' }) {
    setLoading(true);
    setError(null);
    setJobError(null);
    setValidationScan(null);
    clearPoll();
    try {
      const res = await fetch(`/api/import/sessions/${sessionId}/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_settings: extra?.ambiguous_date_format ?
            { ambiguous_date_format: extra.ambiguous_date_format }
          : undefined,
        }),
      });
      const payload = await readResponseJson<{ jobId?: string; error?: string; message?: string }>(res);
      if (!res.ok) throw new Error(payload.message ?? payload.error ?? 'Validation failed');
      setIssues([]);
      setCounts(null);
      setSummary(null);
      await waitForValidation();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Validation failed');
      setLoading(false);
      setPolling(false);
    }
  }

  async function applyDateFormat() {
    if (!dateChoice) return;
    await runValidation({ ambiguous_date_format: dateChoice });
  }

  async function bulkDecision(issueType: string, decision: 'skip' | 'update_existing' | 'import_anyway') {
    const res = await fetch(`/api/import/sessions/${sessionId}/issues/bulk-decide`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issue_type: issueType, user_decision: decision }),
    });
    if (!res.ok) return;
    const det = await fetchSession(sessionId);
    applyLoaded(det);
  }

  async function patchIssue(issueId: string, user_decision: 'skip' | 'update_existing' | 'import_anyway') {
    setPatchingId(issueId);
    try {
      const res = await fetch(`/api/import/sessions/${sessionId}/issues/${issueId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_decision }),
      });
      if (!res.ok) return;
      const det = await fetchSession(sessionId);
      applyLoaded(det);
    } finally {
      setPatchingId(null);
    }
  }

  const grouped = useMemo(() => groupByIssueType(issues), [issues]);
  const clientPlural = `${clientLabel}s`;

  const totalRows = summary?.total_data_rows ?? null;
  const rowsReady = summary?.rows_ready ?? null;
  const blockingRows = summary?.rows_with_blocking_errors ?? null;
  const existingRows = summary?.rows_with_existing_client_warning ?? null;
  const staffSkipped = summary?.staff_files_skipped ?? 0;

  const unresolvedExistingClientCount = useMemo(
    () =>
      issues.filter((i) => i.issue_type === 'existing_client' && !i.user_decision).length,
    [issues],
  );
  const bookingDefaultsBlocking = useMemo(
    () => issues.some((i) => i.issue_type === 'booking_defaults_missing'),
    [issues],
  );

  const canProceed =
    !jobError &&
    !loading &&
    !polling &&
    unresolvedExistingClientCount === 0 &&
    !bookingDefaultsBlocking;

  const friendlyTypeLabel = (t: string) => {
    if (t === 'reference_skipped') return 'Services or staff you chose to skip';
    if (t === 'booking_defaults_missing') return 'Venue setup needed before bookings can import';
    if (t === 'no_contact_details') return 'Rows with no way to identify the client';
    if (t === 'skipped_at_execute') return 'Rows skipped during import';
    if (t === 'missing_required') return 'Rows missing required information';
    if (t === 'email_invalid') return 'Email addresses that look wrong';
    if (t === 'duplicate_email') return 'Duplicate email addresses in your file';
    if (t === 'duplicate_phone') return 'Duplicate phone numbers in your file';
    if (t === 'existing_client') return 'Clients that already exist in ResNeo';
    if (t === 'date_format_ambiguous') return 'Dates that could be read two ways';
    if (t === 'duplicate_external_client_id') return 'Duplicate client IDs in your file';
    if (t === 'duplicate_external_appointment_id') return 'Duplicate appointment IDs';
    if (t === 'phone_invalid') return 'Phone numbers that look wrong';
    return t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  };

  const decisionLabel = (d: string) => {
    if (d === 'update_existing') return 'Update existing';
    if (d === 'import_anyway') return 'Import anyway';
    if (d === 'skip') return 'Skip row';
    return d.replace(/_/g, ' ');
  };

  const isSyntheticReferenceIssue = (i: Issue) =>
    i.issue_type === 'reference_skipped' ||
    i.issue_type === 'booking_defaults_missing' ||
    i.row_number >= 800_000;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Validate</h1>
        <p className="mt-1 text-sm text-slate-500">
          We scan your rows for missing fields, duplicates, and ambiguous dates. Large files are checked in the
          background — your progress is saved, so you can safely leave and come back.
        </p>
      </div>

      {!loading && !polling && plan && (
        <div className="rounded-xl border border-brand-200 bg-gradient-to-br from-brand-50 to-white p-4 shadow-sm">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-brand-700">Your import plan</p>
          <p className="mt-1 text-base font-bold text-slate-900">{plan.headline}</p>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-700">{plan.narrative}</p>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
      )}

      {jobError && (
        <div className="space-y-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <p>{jobError}</p>
          <button
            type="button"
            onClick={() => void runValidation()}
            className="min-h-10 rounded-lg bg-red-900 px-3 py-2 text-sm font-semibold text-white hover:bg-red-950"
          >
            Retry validation
          </button>
        </div>
      )}

      {(loading || polling) && (
        <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
            <span className="text-sm text-slate-600">
              {polling ? 'Scanning CSV rows on the server…' : 'Starting validation…'}
            </span>
          </div>
          {polling && validationScan && validationScan.total > 0 && (
            <div className="space-y-1 pt-1">
              <div
                className="h-2 w-full overflow-hidden rounded-full bg-slate-100"
                role="progressbar"
                aria-valuenow={validationScan.percent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Validation progress"
              >
                <div className="h-full bg-brand-600 transition-all" style={{ width: `${validationScan.percent}%` }} />
              </div>
              <p className="text-xs text-slate-500" aria-live="polite">
                {validationScan.processed.toLocaleString()} / {validationScan.total.toLocaleString()} rows (
                {validationScan.percent}%)
              </p>
            </div>
          )}
          {polling && (!validationScan || validationScan.total === 0) && (
            <p className="text-xs text-slate-500">Preparing row scan…</p>
          )}
          {polling && (
            <p className="text-xs text-slate-500">Your progress is saved — you can safely leave and come back.</p>
          )}
        </div>
      )}

      {!loading && !polling && summary && totalRows !== null && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-base font-semibold text-slate-900">Validation complete</p>
          <ul className="mt-3 space-y-2 text-sm text-slate-700">
            <li className="flex gap-2">
              <span className="text-emerald-600">✓</span>
              <span>
                <strong>{rowsReady ?? '—'}</strong> of {totalRows} data rows ready to import
                {blockingRows != null && blockingRows > 0 ?
                  ` (${blockingRows} row${blockingRows === 1 ? '' : 's'} with blocking issues)`
                : ''}
              </span>
            </li>
            <li className="flex gap-2">
              <span className="text-amber-600">⚠</span>
              <span>
                {counts?.warningCount ?? summary.warning_issue_count ?? 0} warning
                {(counts?.warningCount ?? summary.warning_issue_count ?? 0) === 1 ? '' : 's'}
                {existingRows != null && existingRows > 0 ?
                  ` · ${existingRows} row${existingRows === 1 ? '' : 's'} may match existing ${clientPlural.toLowerCase()}`
                : ''}
              </span>
            </li>
            <li className="flex gap-2">
              <span className="text-red-600">✗</span>
              <span>
                {counts?.errorCount ?? summary.error_issue_count ?? 0} error
                {(counts?.errorCount ?? summary.error_issue_count ?? 0) === 1 ? '' : 's'} (affects import unless you
                choose import anyway where offered)
              </span>
            </li>
            {staffSkipped > 0 && (
              <li className="text-xs text-slate-500">
                {staffSkipped} staff list file{staffSkipped === 1 ? '' : 's'} skipped (not imported as data rows).
              </li>
            )}
          </ul>
        </div>
      )}

      {!loading && !polling && !summary && counts && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-base font-semibold text-slate-900">Validation summary</p>
          <ul className="mt-2 space-y-1 text-sm text-slate-600">
            <li className="text-red-700">Errors: {counts.errorCount}</li>
            <li className="text-amber-800">Warnings: {counts.warningCount}</li>
          </ul>
        </div>
      )}

      {!loading && !polling && issues.some((i) => i.issue_type === 'date_format_ambiguous') && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <p className="font-medium">Ambiguous dates detected</p>
          <p className="mt-1">Choose how to read numeric dates like 03/04/2025.</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select
              value={dateChoice}
              onChange={(e) => setDateChoice(e.target.value as 'dd/MM/yyyy' | 'MM/dd/yyyy' | '')}
              className="min-h-10 rounded-lg border border-amber-300 bg-white px-2 py-2 text-sm"
            >
              <option value="">Select format…</option>
              <option value="dd/MM/yyyy">DD/MM/YYYY (UK)</option>
              <option value="MM/dd/yyyy">MM/DD/YYYY (US)</option>
            </select>
            <button
              type="button"
              onClick={() => void applyDateFormat()}
              className="min-h-10 rounded-lg bg-amber-800 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-900"
            >
              Apply and re-validate
            </button>
          </div>
        </div>
      )}

      {!loading && !polling && issues.some((i) => i.issue_type === 'existing_client') && (
        <div className="flex flex-wrap gap-2 rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2">
          <button
            type="button"
            onClick={() => void bulkDecision('existing_client', 'update_existing')}
            className="min-h-10 rounded-lg bg-slate-800 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-900"
          >
            Update all existing {clientPlural.toLowerCase()}
          </button>
          <button
            type="button"
            onClick={() => void bulkDecision('existing_client', 'skip')}
            className="min-h-10 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
          >
            Skip all duplicates
          </button>
        </div>
      )}

      {!loading && !polling && issues.some((i) => i.issue_type === 'email_invalid') && (
        <div className="flex flex-wrap gap-2 rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2">
          <span className="self-center text-xs text-slate-600">Invalid email format:</span>
          <button
            type="button"
            onClick={() => void bulkDecision('email_invalid', 'import_anyway')}
            className="min-h-10 rounded-lg bg-slate-800 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-900"
          >
            Import all without email where invalid
          </button>
          <button
            type="button"
            onClick={() => void bulkDecision('email_invalid', 'skip')}
            className="min-h-10 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
          >
            Skip all these rows
          </button>
        </div>
      )}

      {!loading && !polling && issues.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-slate-900">Issues by type</h2>
          {[...grouped.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([issueType, list]) => (
              <div key={issueType} className="rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-100 px-3 py-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {friendlyTypeLabel(issueType)}
                  </p>
                  <p className="text-xs text-slate-500">{list.length} issue{list.length === 1 ? '' : 's'}</p>
                </div>
                <ul className="max-h-56 divide-y divide-slate-100 overflow-y-auto">
                  {list.map((i) => (
                    <li key={i.id} className="flex flex-wrap items-start gap-2 px-3 py-2 text-xs">
                      <div className="min-w-0 flex-1">
                        <span className={i.severity === 'error' ? 'text-red-800' : 'text-amber-900'}>
                          {isSyntheticReferenceIssue(i) ?
                            <>
                              {filesById[i.file_id] ? `${filesById[i.file_id]} · ` : ''}
                              {i.message}
                            </>
                          : <>
                              Row {i.row_number}
                              {filesById[i.file_id] ? ` · ${filesById[i.file_id]}` : ''}: {i.message}
                            </>
                          }
                        </span>
                        {i.user_decision && (
                          <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                            {decisionLabel(i.user_decision)}
                          </span>
                        )}
                      </div>
                      {!isSyntheticReferenceIssue(i) && (
                        <button
                          type="button"
                          className="shrink-0 rounded border border-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-700 hover:bg-slate-50"
                          onClick={() =>
                            setPreview({
                              fileId: i.file_id,
                              row: i.row_number,
                              filename: filesById[i.file_id] ?? 'File',
                            })
                          }
                        >
                          View row
                        </button>
                      )}
                      {i.issue_type === 'existing_client' && (
                        <select
                          className="rounded border border-slate-200 px-1 py-0.5 text-[10px]"
                          value={i.user_decision ?? ''}
                          disabled={patchingId === i.id}
                          onChange={(e) => {
                            const v = e.target.value as 'skip' | 'update_existing' | '';
                            if (!v) return;
                            void patchIssue(i.id, v);
                          }}
                        >
                          <option value="">Decide…</option>
                          <option value="update_existing">Update existing</option>
                          <option value="skip">Skip row</option>
                        </select>
                      )}
                      {i.issue_type === 'email_invalid' && (
                        <select
                          className="rounded border border-slate-200 px-1 py-0.5 text-[10px]"
                          value={i.user_decision ?? ''}
                          disabled={patchingId === i.id}
                          onChange={(e) => {
                            const v = e.target.value as 'import_anyway' | 'skip' | '';
                            if (!v) return;
                            void patchIssue(i.id, v);
                          }}
                        >
                          <option value="">Decide…</option>
                          <option value="import_anyway">Import anyway</option>
                          <option value="skip">Skip row</option>
                        </select>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
        </div>
      )}

      {!loading && !polling && bookingDefaultsBlocking && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          <p className="font-medium">Venue not ready for booking import</p>
          <p className="mt-1 text-xs">
            Resolve the &quot;Booking defaults missing&quot; issue below (configure the venue, then re-validate) before
            you can start the import.
          </p>
        </div>
      )}

      {!loading && !polling && unresolvedExistingClientCount > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-medium">
            Decide what to do with {unresolvedExistingClientCount} existing-{clientLabel.toLowerCase()} match
            {unresolvedExistingClientCount === 1 ? '' : 'es'}
          </p>
          <p className="mt-1 text-xs">
            Choose &quot;Update existing&quot; or &quot;Skip&quot; for each row, or use the bulk action above. The
            import cannot start while any are unresolved.
          </p>
        </div>
      )}

      {!loading && !polling && rowsReady !== null && totalRows !== null && (
        <div className="rounded-lg border border-brand-100 bg-brand-50/50 px-4 py-3 text-sm text-slate-800">
          <p className="font-medium text-brand-950">Ready to import</p>
          <p className="mt-1 text-xs text-slate-600">
            Up to <strong>{rowsReady}</strong> rows can be processed from <strong>{totalRows}</strong> data rows.
            Rows with unresolved blocking errors will be skipped unless you chose &quot;import anyway&quot; for email
            issues.
          </p>
        </div>
      )}

      {!loading && !polling && hasBookingFile && (
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
              checked={sendImportReminders}
              disabled={savingImportCommsPref}
              onChange={(e) => {
                const enabled = e.target.checked;
                setSendImportReminders(enabled);
                void persistSendImportReminders(enabled);
              }}
            />
            <span>
              <span className="font-medium text-slate-900">Send upcoming reminders for imported bookings</span>
              <span className="mt-1 block text-xs text-slate-600">
                On by default. Booking confirmations are not resent for imported bookings, but scheduled reminders
                (for example 24 hours and 2 hours before the appointment, per your Communications settings) will run for
                future bookings when their send time is still ahead. Reminders whose window has already passed at import
                are not sent.
              </span>
              {savingImportCommsPref && (
                <span className="mt-1 block text-xs text-slate-500">Saving…</span>
              )}
            </span>
          </label>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href={`/dashboard/import/${sessionId}/references`}
          className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Back
        </Link>
        <div className="flex flex-wrap gap-2">
          <a
            href={`/api/import/sessions/${sessionId}/report`}
            className={`rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 ${
              loading || polling ? 'pointer-events-none opacity-50' : ''
            }`}
          >
            Download report CSV
          </a>
          <button
            type="button"
            disabled={!canProceed}
            onClick={() => setShowApprove(true)}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Review &amp; approve
          </button>
        </div>
      </div>

      <Dialog
        open={showApprove}
        onOpenChange={(next) => {
          if (!next) setShowApprove(false);
        }}
        size="md"
        contentClassName="max-w-lg"
        title="Review & approve import"
        description="This is the last step before anything is written to your venue."
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowApprove(false)}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Not yet
            </button>
            <Link
              href={`/dashboard/import/${sessionId}/importing`}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
            >
              Approve &amp; start import
            </Link>
          </div>
        }
      >
        {plan && (
          <div className="mb-3 rounded-lg border border-brand-100 bg-brand-50/60 p-3">
            <p className="text-sm font-semibold text-slate-900">{plan.headline}</p>
            <p className="mt-1 text-sm leading-relaxed text-slate-700">{plan.narrative}</p>
          </div>
        )}
        <p className="text-sm font-medium text-slate-700">Here&rsquo;s what will happen when you approve:</p>
        <ul className="mt-2 space-y-1.5 text-sm text-slate-700">
          {rowsReady != null && (
            <li className="flex items-start gap-2">
              <span aria-hidden className="mt-0.5 font-semibold text-emerald-600">✓</span>
              <span>
                <strong>{rowsReady}</strong> row{rowsReady === 1 ? '' : 's'} ready to import.
              </span>
            </li>
          )}
          {existingRows != null && existingRows > 0 && (
            <li className="flex items-start gap-2">
              <span aria-hidden className="mt-0.5 font-semibold text-sky-600">↻</span>
              <span>
                <strong>{existingRows}</strong> match existing {clientPlural.toLowerCase()} — handled per your choices above.
              </span>
            </li>
          )}
          {blockingRows != null && blockingRows > 0 && (
            <li className="flex items-start gap-2">
              <span aria-hidden className="mt-0.5 font-semibold text-amber-600">⚠</span>
              <span>
                <strong>{blockingRows}</strong> row{blockingRows === 1 ? '' : 's'} with unresolved issues will be skipped.
              </span>
            </li>
          )}
          {staffSkipped > 0 && (
            <li className="flex items-start gap-2">
              <span aria-hidden className="mt-0.5 text-slate-400">•</span>
              <span>
                <strong>{staffSkipped}</strong> staff file{staffSkipped === 1 ? '' : 's'} used for matching only (not imported as bookings).
              </span>
            </li>
          )}
        </ul>
        <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          This creates real {clientPlural.toLowerCase()} and bookings in your venue. You can undo the whole import for 24 hours
          afterwards.
        </p>
      </Dialog>

      {preview && (
        <ImportRowPreviewDialog
          open
          sessionId={sessionId}
          fileId={preview.fileId}
          rowNumber={preview.row}
          filename={preview.filename}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}
