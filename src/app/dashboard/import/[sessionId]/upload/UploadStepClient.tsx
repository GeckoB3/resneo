'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

type ImportFile = {
  id: string;
  filename: string;
  file_type: string;
  row_count: number | null;
  column_count: number | null;
  headers: string[] | null;
};

export function UploadStepClient({ sessionId }: { sessionId: string }) {
  const [files, setFiles] = useState<ImportFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/import/sessions/${sessionId}`);
    const data = (await res.json()) as { files?: ImportFile[]; error?: string };
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
    try {
      for (const file of Array.from(list)) {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('file_type', 'unknown');
        const res = await fetch(`/api/import/sessions/${sessionId}/files`, {
          method: 'POST',
          body: fd,
        });
        const j = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(j.error ?? 'Upload failed');
      }
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
      const j = (await res.json()) as { error?: string };
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
        <h1 className="text-xl font-semibold text-slate-900">Upload CSV files</h1>
        <p className="mt-1 text-sm text-slate-500">
          Drag and drop one or more <code className="rounded bg-slate-100 px-1">.csv</code> files, then label each as
          client list or booking history.
        </p>
        <p className="mt-2 text-sm text-slate-600">
          <strong className="font-medium text-slate-800">Phorest:</strong> export clients from Marketing → Client Export or
          client reports; export appointments from Manager → Reports → Future Appointments or Staff Appointments (past
          dates supported). Optional: Manager → Services → Export all services to align service names. Course packs,
          vouchers, and account balances are preserved in client custom fields or import metadata where mapped.
        </p>
      </div>

      <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-white px-6 py-14 text-center hover:border-brand-400">
        <input
          type="file"
          accept=".csv,text/csv"
          multiple
          className="hidden"
          disabled={uploading}
          onChange={(e) => void onFilesSelected(e.target.files)}
        />
        <span className="text-sm font-medium text-slate-700">
          {uploading ? 'Uploading…' : 'Drop CSV files here or click to browse'}
        </span>
        <span className="mt-1 text-xs text-slate-500">Multiple files supported</span>
      </label>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
      )}

      {loading ? (
        <div className="flex justify-center py-8">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
        </div>
      ) : (
        <ul className="space-y-3">
          {files.some((f) => f.file_type === 'staff') && (
            <li className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
              <strong>Staff lists</strong> are stored for your reference but are not imported as client or booking rows.
            </li>
          )}
          {files.map((f) => (
            <li
              key={f.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div>
                <p className="text-sm font-medium text-slate-900">{f.filename}</p>
                <p className="text-xs text-slate-500">
                  {f.row_count ?? 0} rows · {f.column_count ?? 0} columns
                </p>
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
                  <option value="staff">Staff</option>
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
          ))}
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
            We detect common exports from Phorest, Fresha, Booksy, Vagaro, ResDiary, and Timely. You can still import from
            other systems by mapping columns manually or using AI suggestions on the next step.
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
        <p className="text-xs text-amber-700">Label each file as Client list or Booking history (not &quot;Not sure&quot;).</p>
      )}
    </div>
  );
}
