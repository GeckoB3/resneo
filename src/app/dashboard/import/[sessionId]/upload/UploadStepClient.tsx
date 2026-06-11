'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { readResponseJson } from '@/lib/api/read-response-json';

type ImportFile = {
  id: string;
  filename: string;
  file_type: string;
  row_count: number | null;
  column_count: number | null;
  headers: string[] | null;
};

type KindDetection = {
  file_id: string;
  filename: string;
  detected_kind: string;
  confidence: string;
  applied: boolean;
  reason: string;
};

const KIND_LABELS: Record<string, string> = {
  clients: 'Client list',
  bookings: 'Booking history',
  staff: 'Staff list',
};

export function UploadStepClient({ sessionId }: { sessionId: string }) {
  const [files, setFiles] = useState<ImportFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [detections, setDetections] = useState<Record<string, KindDetection>>({});

  const load = useCallback(async () => {
    const res = await fetch(`/api/import/sessions/${sessionId}`);
    const data = await readResponseJson<{ files?: ImportFile[]; error?: string }>(res);
    if (!res.ok) {
      setError(data.error ?? 'Failed to load');
      return;
    }
    setFiles(data.files ?? []);
  }, [sessionId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      await load();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function onFilesSelected(list: FileList | null) {
    if (!list?.length) return;
    setUploading(true);
    setError(null);
    setWarnings([]);
    try {
      const collectedWarnings: string[] = [];
      for (const file of Array.from(list)) {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('file_type', 'unknown');
        const res = await fetch(`/api/import/sessions/${sessionId}/files`, {
          method: 'POST',
          body: fd,
        });
        const j = await readResponseJson<{
          error?: string;
          warnings?: string[];
          kind_detections?: KindDetection[];
        }>(res);
        if (!res.ok) throw new Error(j.error ?? 'Upload failed');
        if (Array.isArray(j.warnings)) collectedWarnings.push(...j.warnings);
        if (Array.isArray(j.kind_detections)) {
          setDetections((prev) => {
            const next = { ...prev };
            for (const d of j.kind_detections!) next[d.file_id] = d;
            return next;
          });
        }
      }
      setWarnings(collectedWarnings);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    }
    setUploading(false);
  }

  async function removeFile(id: string) {
    if (!window.confirm('Remove this file from the import?')) return;
    const res = await fetch(`/api/import/sessions/${sessionId}/files/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const j = await readResponseJson<{ error?: string }>(res);
      setError(j.error ?? 'Remove failed');
      return;
    }
    await load();
  }

  async function setType(id: string, file_type: string) {
    const res = await fetch(`/api/import/sessions/${sessionId}/files/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_type }),
    });
    if (!res.ok) return;
    await load();
  }

  const canContinue = files.length > 0 && files.every((f) => f.file_type !== 'unknown');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Upload your files</h1>
        <p className="mt-1 text-sm text-slate-500">
          Drop in whatever exports you have from your previous system — Excel
          (<code className="rounded bg-slate-100 px-1">.xlsx</code>) or CSV both work, exactly as they came out. We
          work out whether each file is a client list, booking history, or staff list; you just confirm. A file that
          mixes client and booking details (most booking exports do) should be labelled{' '}
          <strong>Booking history</strong> — the client details in it are imported too.
        </p>
      </div>

      <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-white px-6 py-14 text-center hover:border-brand-400">
        <input
          type="file"
          accept=".csv,.tsv,.txt,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          multiple
          className="hidden"
          disabled={uploading}
          onChange={(e) => void onFilesSelected(e.target.files)}
        />
        <span className="text-sm font-medium text-slate-700">
          {uploading ? 'Uploading…' : 'Drop CSV or Excel files here, or click to browse'}
        </span>
        <span className="mt-1 text-xs text-slate-500">
          Multiple files supported · each sheet in a workbook is read separately
        </span>
      </label>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
      )}
      {warnings.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
          <p className="font-semibold">We tidied a few things while reading your files:</p>
          <ul className="mt-1 list-inside list-disc space-y-0.5">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-8">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
        </div>
      ) : (
        <ul className="space-y-3">
          {files.some((f) => f.file_type === 'staff') && (
            <li className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-950">
              <strong>Staff lists</strong>: each staff member is matched to your existing calendars on the “Match
              references” step, where you can also add them as new bookable staff.
            </li>
          )}
          {files.map((f) => {
            const det = detections[f.id];
            return (
            <li
              key={f.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div>
                <p className="text-sm font-medium text-slate-900">{f.filename}</p>
                <p className="text-xs text-slate-500">
                  {f.row_count ?? 0} rows · {f.column_count ?? 0} columns
                </p>
                {det?.applied && f.file_type === det.detected_kind && (
                  <p className="mt-1 text-[11px] font-medium text-emerald-700">
                    Auto-detected: {KIND_LABELS[det.detected_kind] ?? det.detected_kind} — change it below if that&apos;s
                    wrong.
                  </p>
                )}
                {det && !det.applied && det.detected_kind !== 'unknown' && f.file_type === 'unknown' && (
                  <p className="mt-1 text-[11px] font-medium text-amber-700">
                    Our best guess: {KIND_LABELS[det.detected_kind] ?? det.detected_kind}. {det.reason} Please confirm
                    below.
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={f.file_type}
                  onChange={(e) => void setType(f.id, e.target.value)}
                  className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                >
                  <option value="unknown">Not sure</option>
                  <option value="clients">Client list</option>
                  <option value="bookings">Booking history</option>
                  <option value="staff">Staff list</option>
                </select>
                <button
                  type="button"
                  onClick={() => void removeFile(f.id)}
                  className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                >
                  Remove
                </button>
              </div>
            </li>
            );
          })}
        </ul>
      )}

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="text-sm font-medium text-brand-700 hover:text-brand-800"
      >
        {expanded ? '▼' : '▶'} What can I import?
      </button>
      {expanded && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          <p className="font-medium text-slate-800">Supported sources</p>
          <p className="mt-2">
            Excel workbooks (.xlsx, .xls) and CSV exports from existing salon, clinic, or restaurant booking systems
            all work — including files with title rows, multiple sheets, or unusual characters. On the next step your
            columns are matched to Resneo fields automatically; you just review the result, so the source platform
            does not need to be recognised.
          </p>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Link
          href="/dashboard/import"
          className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Back
        </Link>
        <Link
          href={`/dashboard/import/${sessionId}/map`}
          className={`rounded-lg px-4 py-2 text-sm font-semibold text-white ${
            canContinue ? 'bg-brand-600 hover:bg-brand-700' : 'cursor-not-allowed bg-slate-300'
          }`}
          onClick={(e) => {
            if (!canContinue) e.preventDefault();
          }}
        >
          Continue
        </Link>
      </div>
      {!canContinue && files.length > 0 && (
        <p className="text-xs text-amber-700">
          Confirm a label for each file — Client list, Booking history, or Staff list. We pre-fill the ones we can
          detect.
        </p>
      )}
    </div>
  );
}
