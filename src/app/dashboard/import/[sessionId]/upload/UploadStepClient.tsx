'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { readResponseJson } from '@/lib/api/read-response-json';

type ImportFile = {
  id: string;
  filename: string;
  file_type: string;
  row_count: number | null;
  column_count: number | null;
  headers: string[] | null;
  reshape_status?: string | null;
  reshaped?: boolean | null;
  reshape_notes?: string[] | null;
};

type ReshapePreview = {
  original: string[][];
  headers: string[];
  rows: string[][];
  total_rows: number;
  notes: string[];
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

/** Small, realistic example files a non-technical user can pattern-match against. */
const SAMPLE_TEMPLATES = {
  clients: {
    filename: 'sample-clients.csv',
    rows: [
      ['First name', 'Last name', 'Email', 'Phone', 'Notes'],
      ['Sarah', 'Jones', 'sarah.jones@example.com', '07700 900123', 'Prefers afternoon appointments'],
      ['Michael', 'Okafor', 'michael.okafor@example.com', '07700 900456', 'Allergic to lavender oil'],
      ['Priya', 'Patel', 'priya.patel@example.com', '07700 900789', ''],
    ],
  },
  bookings: {
    filename: 'sample-bookings.csv',
    rows: [
      ['Date', 'Time', 'Client name', 'Email', 'Phone', 'Service', 'Staff', 'Price', 'Status'],
      ['2025-07-14', '10:00', 'Sarah Jones', 'sarah.jones@example.com', '07700 900123', 'Haircut', 'Emma', '35.00', 'Completed'],
      ['2025-07-14', '11:30', 'Michael Okafor', 'michael.okafor@example.com', '07700 900456', 'Beard trim', 'Daniel', '18.00', 'Completed'],
      ['2025-07-15', '09:15', 'Priya Patel', 'priya.patel@example.com', '07700 900789', 'Colour & cut', 'Emma', '90.00', 'Booked'],
    ],
  },
} as const;

/** Quote a CSV cell when it contains a comma, quote, or newline (RFC 4180). */
function toCsvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function buildSampleCsv(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => row.map(toCsvCell).join(',')).join('\r\n');
}

export function UploadStepClient({ sessionId }: { sessionId: string }) {
  const [files, setFiles] = useState<ImportFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [detections, setDetections] = useState<Record<string, KindDetection>>({});
  const [reshaping, setReshaping] = useState<Set<string>>(new Set());
  const [reshapePreview, setReshapePreview] = useState<Record<string, ReshapePreview>>({});
  const [reshapeFailed, setReshapeFailed] = useState<Record<string, string>>({});
  const [dragActive, setDragActive] = useState(false);
  // Drag events fire on every child element; count enter/leave so the highlight
  // only clears when the cursor truly leaves the drop zone.
  const dragDepth = useRef(0);
  const reshapeTriggered = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    const res = await fetch(`/api/import/sessions/${sessionId}`);
    const data = await readResponseJson<{ files?: ImportFile[]; error?: string }>(res);
    if (!res.ok) {
      setError(data.error ?? 'Failed to load');
      return;
    }
    setFiles(data.files ?? []);
  }, [sessionId]);

  const runReshape = useCallback(
    async (fileId: string) => {
      setReshaping((prev) => new Set(prev).add(fileId));
      try {
        const res = await fetch(`/api/import/sessions/${sessionId}/files/${fileId}/reshape`, { method: 'POST' });
        const j = await readResponseJson<{
          ok?: boolean;
          status?: string;
          message?: string;
          notes?: string[];
          preview?: Omit<ReshapePreview, 'notes'>;
        }>(res);
        if (j.preview) {
          setReshapePreview((prev) => ({ ...prev, [fileId]: { ...j.preview!, notes: j.notes ?? [] } }));
        }
        if (j.status === 'failed') {
          setReshapeFailed((prev) => ({ ...prev, [fileId]: j.message ?? 'Could not reorganise this file.' }));
        }
        await load();
      } catch {
        setReshapeFailed((prev) => ({ ...prev, [fileId]: 'Could not reorganise this file — please try again.' }));
      } finally {
        setReshaping((prev) => {
          const next = new Set(prev);
          next.delete(fileId);
          return next;
        });
      }
    },
    [sessionId, load],
  );

  // Auto-run the reshape for any file the server flagged as report-shaped.
  useEffect(() => {
    for (const f of files) {
      if (f.reshape_status === 'pending' && !reshapeTriggered.current.has(f.id)) {
        reshapeTriggered.current.add(f.id);
        void runReshape(f.id);
      }
    }
  }, [files, runReshape]);

  async function undoReshape(fileId: string) {
    reshapeTriggered.current.add(fileId); // it becomes 'skipped'; don't re-trigger
    const res = await fetch(`/api/import/sessions/${sessionId}/files/${fileId}/reshape`, { method: 'DELETE' });
    if (!res.ok) {
      const j = await readResponseJson<{ error?: string }>(res);
      setError(j.error ?? 'Could not undo');
      return;
    }
    setReshapePreview((prev) => {
      const next = { ...prev };
      delete next[fileId];
      return next;
    });
    await load();
  }

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

  function handleDragEnter(e: React.DragEvent) {
    if (uploading) return;
    e.preventDefault();
    dragDepth.current += 1;
    if (e.dataTransfer?.types?.includes('Files')) setDragActive(true);
  }

  function handleDragOver(e: React.DragEvent) {
    // Calling preventDefault on dragover is required for the drop event to fire.
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragActive(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    dragDepth.current = 0;
    setDragActive(false);
    if (uploading) return;
    const dropped = e.dataTransfer?.files ?? null;
    if (dropped?.length) void onFilesSelected(dropped);
  }

  function downloadSample(kind: keyof typeof SAMPLE_TEMPLATES) {
    const template = SAMPLE_TEMPLATES[kind];
    const csv = buildSampleCsv(template.rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = template.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoke after the click so the browser has time to start the download.
    setTimeout(() => URL.revokeObjectURL(url), 0);
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

  const anyReshaping = reshaping.size > 0 || files.some((f) => f.reshape_status === 'pending');
  const canContinue =
    files.length > 0 && files.every((f) => f.file_type !== 'unknown') && !anyReshaping;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Upload your files</h1>
        <p className="mt-1 text-sm text-slate-500">
          Upload your exports from your old system — Excel or CSV, just as they came. We detect whether each is a
          client list, booking history, or staff list; you just confirm. If a file has both bookings and client
          details (most do), label it <strong>Booking history</strong> — the client details are imported too.
        </p>
      </div>

      <label
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-14 text-center transition-colors ${
          dragActive
            ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-200'
            : 'border-slate-300 bg-white hover:border-brand-400'
        }`}
      >
        <input
          type="file"
          accept=".csv,.tsv,.txt,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          multiple
          className="hidden"
          disabled={uploading}
          onChange={(e) => void onFilesSelected(e.target.files)}
        />
        <span className={`text-sm font-medium ${dragActive ? 'text-brand-800' : 'text-slate-700'}`}>
          {uploading
            ? 'Uploading…'
            : dragActive
              ? 'Drop your files to upload'
              : 'Drop CSV or Excel files here, or click to browse'}
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
            const isReshaping = reshaping.has(f.id) || f.reshape_status === 'pending';
            const preview = reshapePreview[f.id];
            const reshapeError = reshapeFailed[f.id];
            const wasReshaped = f.reshaped === true || f.reshape_status === 'done';
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

              {isReshaping && (
                <div className="basis-full">
                  <div className="flex items-center gap-2 rounded-lg border border-brand-100 bg-brand-50/60 px-3 py-2 text-xs text-brand-900">
                    <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
                    <span>
                      Reorganising this file into a table — reading the dates, times and staff. This can take several
                      minutes for large files, so please keep this tab open.
                    </span>
                  </div>
                </div>
              )}

              {!isReshaping && reshapeError && (
                <div className="basis-full">
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                    {reshapeError}
                  </div>
                </div>
              )}

              {!isReshaping && wasReshaped && (
                <div className="basis-full space-y-2">
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-xs text-emerald-950">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold">
                        ✓ Reorganised into a table ({preview?.total_rows ?? f.row_count ?? 0} bookings).
                      </span>
                      <button
                        type="button"
                        onClick={() => void undoReshape(f.id)}
                        className="rounded-md border border-emerald-300 px-2 py-1 text-[11px] font-medium text-emerald-800 hover:bg-emerald-100"
                      >
                        Undo (use the original)
                      </button>
                    </div>
                    {(preview?.notes?.length || (f.reshape_notes?.length ?? 0) > 0) && (
                      <ul className="mt-1.5 list-inside list-disc space-y-0.5 text-amber-900">
                        {(preview?.notes ?? f.reshape_notes ?? []).map((n, i) => (
                          <li key={i}>{n}</li>
                        ))}
                      </ul>
                    )}
                    <p className="mt-1 text-emerald-800/80">
                      Please glance over the table below to confirm the dates look right, then continue.
                    </p>
                  </div>

                  {preview && (
                    <div className="overflow-x-auto rounded-lg border border-slate-200">
                      <table className="w-full text-left text-[11px]">
                        <thead className="bg-slate-50 text-slate-600">
                          <tr>
                            {preview.headers.map((h, i) => (
                              <th key={i} className="whitespace-nowrap px-2 py-1 font-semibold">
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {preview.rows.map((row, ri) => (
                            <tr key={ri} className="border-t border-slate-100">
                              {preview.headers.map((_, ci) => (
                                <td key={ci} className="whitespace-nowrap px-2 py-1 text-slate-700">
                                  {row[ci] ?? ''}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
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
            columns are matched to ResNeo fields automatically; you just review the result, so the source platform
            does not need to be recognised.
          </p>
          <div className="mt-4 border-t border-slate-200 pt-3">
            <p className="font-medium text-slate-800">Not sure what a file should look like?</p>
            <p className="mt-1 text-xs text-slate-500">
              Download an example to see the kind of columns we expect. Your own file doesn&apos;t need to match
              exactly — these are just a guide.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => downloadSample('clients')}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-brand-700 shadow-sm hover:border-brand-400 hover:text-brand-800"
              >
                <DownloadIcon />
                Download a sample clients CSV
              </button>
              <button
                type="button"
                onClick={() => downloadSample('bookings')}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-brand-700 shadow-sm hover:border-brand-400 hover:text-brand-800"
              >
                <DownloadIcon />
                Download a sample bookings CSV
              </button>
            </div>
          </div>
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
          {anyReshaping
            ? 'Hang on — we’re reorganising a report-style file into a table. Continue unlocks when it’s done.'
            : 'Confirm a label for each file — Client list, Booking history, or Staff list. We pre-fill the ones we can detect.'}
        </p>
      )}
    </div>
  );
}

function DownloadIcon() {
  return (
    <svg
      className="h-3.5 w-3.5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
    </svg>
  );
}
