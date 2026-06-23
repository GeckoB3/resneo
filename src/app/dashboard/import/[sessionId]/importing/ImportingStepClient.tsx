'use client';

import { useEffect, useReducer, useRef, useState } from 'react';
import Link from 'next/link';
import { readResponseJson } from '@/lib/api/read-response-json';
import { useImportTerminology } from '@/components/import/ImportTerminologyContext';

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  if (seconds < 60) return `~${Math.max(1, Math.round(seconds))}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `~${m}m ${s}s`;
}

function formatElapsed(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  const total = Math.round(seconds);
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

type ProgressPayload = {
  status: string;
  started_at?: string | null;
  percent: number;
  progress_processed: number;
  progress_total: number;
  imported_clients: number;
  imported_bookings: number;
  skipped_rows: number;
  updated_existing?: number;
  error_message?: string | null;
};

const EXECUTE_CLIENT_TIMEOUT_MS = 280_000;
const POLL_FAILURE_THRESHOLD = 8;

function createExecuteAbortSignal(): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const t = window.setTimeout(() => controller.abort(), EXECUTE_CLIENT_TIMEOUT_MS);
  return {
    signal: controller.signal,
    cancel: () => clearTimeout(t),
  };
}

export function ImportingStepClient({ sessionId }: { sessionId: string }) {
  const { clientLabel } = useImportTerminology();
  /** Wall-clock baseline for elapsed + ETA (before first execute POST, or server `started_at` when resuming). */
  const importStartMs = useRef<number | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [, forceTimeTick] = useReducer((n: number) => n + 1, 0);
  const [started, setStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [executingBatch, setExecutingBatch] = useState(false);
  const [progress, setProgress] = useState<ProgressPayload | null>(null);
  const [pollFailureCount, setPollFailureCount] = useState(0);
  const [pollError, setPollError] = useState<string | null>(null);
  const [qaReport, setQaReport] = useState<{
    checked: number;
    matched: number;
    mismatches: unknown[];
    summary: string;
  } | null>(null);
  const qaRequested = useRef(false);

  useEffect(() => {
    if (progress?.status !== 'importing' && !executingBatch) return undefined;
    const id = window.setInterval(() => forceTimeTick(), 1000);
    return () => clearInterval(id);
  }, [progress?.status, executingBatch]);

  /** Post-import QA spot-check: runs once when the import reaches complete. */
  useEffect(() => {
    if (progress?.status !== 'complete' || qaRequested.current) return;
    qaRequested.current = true;
    void (async () => {
      try {
        const res = await fetch(`/api/import/sessions/${sessionId}/qa`, { method: 'POST' });
        if (!res.ok) return;
        const j = await readResponseJson<{ report?: typeof qaReport }>(res);
        if (j.report) setQaReport(j.report);
      } catch {
        /* QA is advisory; never block the completion screen */
      }
    })();
  }, [progress?.status, sessionId]);

  /**
   * No `didRun` ref: React 18 Strict Mode runs effects as mount → cleanup → mount. A ref “run once”
   * survives that cycle and skips the second mount, cancelling all async/poll timers with nothing left
   * to restart — progress/UI stuck until refresh.
   */
  useEffect(() => {
    let cancelled = false;

    function clearPollTimer() {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    }

    function ensureImportClock(data: ProgressPayload) {
      if (importStartMs.current !== null) return;
      if (data.status === 'importing' && data.started_at) {
        const t = Date.parse(data.started_at);
        if (!Number.isNaN(t)) importStartMs.current = t;
      }
    }

    async function pollOnce(): Promise<ProgressPayload> {
      const pr = await fetch(`/api/import/sessions/${sessionId}/progress`, { cache: 'no-store' });
      const data = await readResponseJson<ProgressPayload & { error?: string }>(pr);
      if (!pr.ok) {
        throw new Error(data.error ?? 'Failed to load import progress');
      }
      setPollFailureCount(0);
      setPollError(null);
      ensureImportClock(data);
      if (!cancelled) setProgress(data);
      if (data.status === 'complete' || data.status === 'failed') {
        clearPollTimer();
      }
      return data;
    }

    void (async () => {
      setStarted(true);
      setError(null);
      try {
        pollTimerRef.current = setInterval(() => {
          void (async () => {
            try {
              await pollOnce();
            } catch (e) {
              if (cancelled) return;
              setPollFailureCount((n) => {
                const next = n + 1;
                if (next >= POLL_FAILURE_THRESHOLD) {
                  setPollError(
                    e instanceof Error ?
                      e.message
                    : 'Could not load import progress. Check you are still signed in, then refresh this page.',
                  );
                }
                return next;
              });
            }
          })();
        }, 1000);

        const first = await pollOnce();
        if (cancelled) return;
        if (first.status === 'complete' || first.status === 'failed') {
          return;
        }

        // Resume or start: drive batched execute while background polling updates the bar.
        let keepDriving = true;
        while (keepDriving && !cancelled) {
          if (importStartMs.current === null) importStartMs.current = Date.now();
          setExecutingBatch(true);
          let res: Response;
          const { signal, cancel } = createExecuteAbortSignal();
          try {
            res = await fetch(`/api/import/sessions/${sessionId}/execute`, {
              method: 'POST',
              cache: 'no-store',
              signal,
            });
          } catch (e) {
            if (e instanceof DOMException && e.name === 'AbortError') {
              throw new Error(
                'The import request timed out in your browser. The server may still be working — wait a minute and refresh this page to see updated progress.',
              );
            }
            throw e instanceof Error ? e : new Error('Import request failed');
          } finally {
            cancel();
            setExecutingBatch(false);
          }
          const body = await readResponseJson<{
            ok?: boolean;
            done?: boolean;
            error?: string;
            message?: string;
          }>(res);
          if (!res.ok) {
            throw new Error(body.message ?? body.error ?? 'Import failed');
          }
          await pollOnce();
          if (body.done === true) {
            let spins = 0;
            while (!cancelled && spins < 400) {
              const d = await pollOnce();
              if (d.status === 'complete' || d.status === 'failed') break;
              await new Promise((r) => setTimeout(r, 200));
              spins += 1;
            }
            keepDriving = false;
          }
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Import failed');
        }
      }
    })();

    return () => {
      cancelled = true;
      clearPollTimer();
    };
  }, [sessionId]);

  const pct = progress?.percent ?? 0;

  const elapsedLabel = (() => {
    const p = progress;
    if (!p || p.status !== 'importing' || !importStartMs.current) return null;
    const elapsedSec = (Date.now() - importStartMs.current) / 1000;
    return formatElapsed(elapsedSec);
  })();

  const etaLabel = (() => {
    const p = progress;
    if (!p || p.status !== 'importing' || !importStartMs.current) return null;
    const done = p.progress_processed;
    const total = p.progress_total;
    if (!total) return null;
    if (done <= 0) return null;
    if (done >= total) return null;
    const elapsedSec = (Date.now() - importStartMs.current) / 1000;
    if (elapsedSec < 2) return null;
    const rate = done / elapsedSec;
    if (rate <= 0) return null;
    const remaining = (total - done) / rate;
    return formatEta(remaining);
  })();

  const stageLabel = (() => {
    if (!started) return null;
    if (error) return null;
    if (pollError) return 'Could not refresh status';
    const st = progress?.status;
    if (st === 'complete') return 'Finalised';
    if (st === 'failed') return 'Stopped';
    if (executingBatch) return 'Processing a batch on the server…';
    if (st === 'importing') return 'Import in progress…';
    if (st === 'ready') return 'Starting import…';
    if (st === 'validating') return 'Validation still running — finish the Validate step, or wait and refresh.';
    if (st === 'mapping') return 'Mappings not finished — complete the Map step first.';
    if (st === 'uploading') return 'Upload not complete — finish the Upload step first.';
    if (st === 'undone') return 'This import was undone.';
    /** First paint before the first `/progress` response (or stalled load). */
    if (progress == null) return 'Loading import status…';
    return `Session status: ${st}`;
  })();

  /** Non-blocking hint when progress polls fail repeatedly (distinct from fatal execute error). */
  const stallHint = pollError && !error;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Importing</h1>
        <p className="mt-1 text-sm text-slate-500">
          Large imports run in batches. You can leave this page — progress is saved. Open this step again anytime to
          resume.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
      )}

      {stallHint && (
        <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          <p>
            <strong>Status updates paused.</strong> {pollError}
            {pollFailureCount > 0 ? ` (${pollFailureCount} failed checks)` : ''}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="min-h-9 rounded-lg bg-amber-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-950"
          >
            Refresh page
          </button>
        </div>
      )}

      {started && !error && (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-slate-800">Progress</p>
            {stageLabel && (
              <p className="text-xs font-medium text-brand-800" aria-live="polite">
                {stageLabel}
              </p>
            )}
          </div>
          <div
            className="h-3 w-full overflow-hidden rounded-full bg-slate-100"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Import progress"
          >
            <div className="h-full bg-brand-600 transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-xs text-slate-600" aria-live="polite">
            {progress?.progress_processed ?? 0} / {progress?.progress_total ?? 0} rows · {pct}%
            {elapsedLabel ? ` · Elapsed ${elapsedLabel}` : ''}
            {etaLabel ? ` · ${etaLabel} remaining` : ''}
          </p>
          {progress?.status === 'importing' &&
            executingBatch &&
            (progress.progress_processed ?? 0) === 0 &&
            (progress.progress_total ?? 0) > 0 && (
              <p className="text-xs text-slate-500">
                Row counts update after each server batch (often within the first minute on large files).
              </p>
            )}
          {progress?.status === 'complete' && (
            <div className="space-y-2 pt-2 text-sm text-slate-800">
              <p className="font-semibold text-emerald-800">Import complete</p>
              <p>
                {capitalize(clientLabel)}s processed: {progress.imported_clients ?? 0}
                {progress.updated_existing != null && progress.updated_existing > 0 ?
                  ` (${progress.updated_existing} existing updated)`
                : ''}
              </p>
              <p>
                Bookings: {progress.imported_bookings ?? 0} · Skipped rows: {progress.skipped_rows ?? 0}
              </p>
              {qaReport && qaReport.checked > 0 && (
                <p
                  className={`rounded-lg border px-2.5 py-1.5 text-xs ${
                    qaReport.mismatches.length === 0
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                      : 'border-amber-200 bg-amber-50 text-amber-950'
                  }`}
                >
                  {qaReport.summary}
                </p>
              )}
              <a
                href={`/api/import/sessions/${sessionId}/report`}
                className="inline-block font-medium text-emerald-800 hover:text-emerald-900"
              >
                Download import report (CSV)
              </a>
              <Link href="/dashboard/guests" className="inline-block font-medium text-brand-700 hover:text-brand-800">
                View {clientLabel.toLowerCase()}s →
              </Link>
              <div className="pt-2">
                <Link
                  href="/dashboard/import"
                  className="text-sm font-medium text-slate-600 hover:text-slate-900"
                >
                  Back to import history
                </Link>
              </div>
            </div>
          )}
          {progress?.status === 'failed' && (
            <div className="space-y-2 pt-2 text-sm text-red-800">
              <p className="font-semibold">Import failed</p>
              {progress.error_message?.trim() ?
                <p className="rounded border border-red-100 bg-red-50/80 px-2 py-1.5 text-xs text-red-900">
                  {progress.error_message}
                </p>
              : <p className="text-xs text-red-700">No error details were returned. Check import history or try again.</p>}
              <Link href="/dashboard/import" className="inline-block text-sm font-medium text-red-900 underline">
                Back to import history
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
