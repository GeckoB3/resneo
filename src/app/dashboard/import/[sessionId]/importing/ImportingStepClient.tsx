'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { readResponseJson } from '@/lib/api/read-response-json';

function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  if (seconds < 60) return `~${Math.max(1, Math.round(seconds))}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `~${m}m ${s}s`;
}

export function ImportingStepClient({ sessionId }: { sessionId: string }) {
  const ran = useRef(false);
  const importStartMs = useRef<number | null>(null);
  const [started, setStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{
    status: string;
    percent: number;
    progress_processed: number;
    progress_total: number;
    imported_clients: number;
    imported_bookings: number;
    skipped_rows: number;
    updated_existing?: number;
  } | null>(null);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    async function poll() {
      const pr = await fetch(`/api/import/sessions/${sessionId}/progress`);
      const data = await readResponseJson<{
        status: string;
        percent: number;
        progress_processed: number;
        progress_total: number;
        imported_clients: number;
        imported_bookings: number;
        skipped_rows: number;
        updated_existing?: number;
      }>(pr);
      if (data.status === 'importing' && importStartMs.current === null) {
        importStartMs.current = Date.now();
      }
      setProgress(data);
      if (data.status === 'complete' || data.status === 'failed') {
        if (timer) clearInterval(timer);
      }
    }
    void (async () => {
      setStarted(true);
      setError(null);
      try {
        const prog0 = await fetch(`/api/import/sessions/${sessionId}/progress`);
        const initial = await readResponseJson<{ status?: string }>(prog0);
        if (initial.status === 'complete' || initial.status === 'failed') {
          setProgress(initial as typeof progress);
          return;
        }
        const res = await fetch(`/api/import/sessions/${sessionId}/execute`, { method: 'POST' });
        const body = await readResponseJson<{ ok?: boolean; error?: string; message?: string }>(res);
        if (!res.ok) {
          throw new Error(body.message ?? body.error ?? 'Import failed to start');
        }
        await poll();
        timer = setInterval(() => void poll(), 1200);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Import failed');
      }
    })();
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [sessionId]);

  const pct = progress?.percent ?? 0;

  const etaLabel = (() => {
    const p = progress;
    if (!p || p.status !== 'importing' || !importStartMs.current) return null;
    const done = p.progress_processed;
    const total = p.progress_total;
    if (done <= 0 || total <= done || !total) return null;
    const elapsedSec = (Date.now() - importStartMs.current) / 1000;
    const rate = done / elapsedSec;
    if (rate <= 0) return null;
    const remaining = (total - done) / rate;
    return formatEta(remaining);
  })();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Importing</h1>
        <p className="mt-1 text-sm text-slate-500">Your data is being imported. You can leave this page — the job runs on the server.</p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
      )}

      {started && !error && (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-medium text-slate-800">Progress</p>
          <div className="h-3 w-full overflow-hidden rounded-full bg-slate-100">
            <div className="h-full bg-brand-600 transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-xs text-slate-600">
            {progress?.progress_processed ?? 0} / {progress?.progress_total ?? 0} rows · {pct}%
            {etaLabel ? ` · ${etaLabel} remaining` : ''}
          </p>
          {progress?.status === 'complete' && (
            <div className="space-y-2 pt-2 text-sm text-slate-800">
              <p className="font-semibold text-emerald-800">Import complete</p>
              <p>
                Clients processed: {progress.imported_clients ?? 0}
                {progress.updated_existing != null && progress.updated_existing > 0 ?
                  ` (${progress.updated_existing} existing updated)`
                : ''}
              </p>
              <p>
                Bookings: {progress.imported_bookings ?? 0} · Skipped rows: {progress.skipped_rows ?? 0}
              </p>
              <a
                href={`/api/import/sessions/${sessionId}/report`}
                className="inline-block font-medium text-emerald-800 hover:text-emerald-900"
              >
                Download import report (CSV)
              </a>
              <Link href="/dashboard/guests" className="inline-block font-medium text-brand-700 hover:text-brand-800">
                View clients →
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
            <p className="text-sm text-red-700">Import failed. Check the import history for details.</p>
          )}
        </div>
      )}
    </div>
  );
}
