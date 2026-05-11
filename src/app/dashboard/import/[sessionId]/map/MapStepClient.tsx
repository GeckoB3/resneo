'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { readResponseJson } from '@/lib/api/read-response-json';
import { CLIENT_FIELDS, BOOKING_FIELDS } from '@/lib/import/constants';
import { ImportMapDndView, type ColumnDetail, type MapDndMapping } from '@/components/import/ImportMapDndView';
import { useImportTerminology } from '@/components/import/ImportTerminologyContext';

type MappingRow = {
  id?: string;
  file_id: string;
  source_column: string;
  target_field: string | null;
  action: string;
  custom_field_name?: string | null;
  custom_field_type?: string | null;
  split_config?: Record<string, unknown> | null;
  ai_suggested?: boolean;
  ai_confidence?: string | null;
  ai_reasoning?: string | null;
  user_overridden?: boolean;
};

type ImportFile = {
  id: string;
  filename: string;
  file_type: string;
  headers: string[] | null;
  sample_rows: Record<string, string>[] | null;
};

export function MapStepClient({ sessionId }: { sessionId: string }) {
  const { clientLabel } = useImportTerminology();
  const [files, setFiles] = useState<ImportFile[]>([]);
  const [mappings, setMappings] = useState<MappingRow[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/import/sessions/${sessionId}`);
    const data = await readResponseJson<{
      files?: ImportFile[];
      mappings?: MappingRow[];
      session?: { detected_platform?: string | null; ai_mapping_used?: boolean };
      error?: string;
    }>(res);
    if (!res.ok) throw new Error(data.error ?? 'Failed to load');
    setFiles(data.files ?? []);
    setMappings(data.mappings ?? []);
    if (data.files?.[0]?.id) setActiveFileId(data.files[0].id);
    if (data.session?.detected_platform && data.session?.ai_mapping_used) {
      setBanner(`We detected a ${data.session.detected_platform} export. Review mappings below.`);
    }
  }, [sessionId]);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load');
      }
      setLoading(false);
    })();
  }, [load]);

  const activeFile = files.find((f) => f.id === activeFileId) ?? files[0] ?? null;

  const targetOptions = useMemo(() => {
    if (!activeFile) return [];
    return activeFile.file_type === 'bookings' ? BOOKING_FIELDS : CLIENT_FIELDS;
  }, [activeFile]);

  const dndMappingsForActive: MapDndMapping[] = useMemo(() => {
    if (!activeFile) return [];
    return mappings
      .filter((m) => m.file_id === activeFile.id && (m.action === 'map' || m.action === 'ignore'))
      .map((m) => ({
        file_id: m.file_id,
        source_column: m.source_column,
        target_field: m.target_field,
        action: m.action,
        ai_confidence: m.ai_confidence,
        ai_suggested: m.ai_suggested,
      }));
  }, [mappings, activeFile]);

  const columnDetailsForActive: ColumnDetail[] = useMemo(() => {
    if (!activeFile) return [];
    return mappings
      .filter((m) => m.file_id === activeFile.id)
      .map((m) => ({
        source_column: m.source_column,
        action: m.action,
        target_field: m.target_field,
        ai_confidence: m.ai_confidence,
      }));
  }, [mappings, activeFile]);

  function handleCreateCustomField(source: string) {
    if (!activeFile) return;
    const cleanName = source.replace(/[^\w\s\-'.]/g, '').trim().slice(0, 80) || 'Custom field';
    setMappings((prev) => {
      const base = prev.filter(
        (m) => !(m.file_id === activeFile.id && m.source_column === source),
      );
      base.push({
        file_id: activeFile.id,
        source_column: source,
        target_field: null,
        action: 'custom',
        custom_field_name: cleanName,
        custom_field_type: 'text',
      });
      return base;
    });
  }

  function handleDndChange(next: MapDndMapping[]) {
    if (!activeFile) return;
    setMappings((prev) => {
      const preserved = prev.filter(
        (m) =>
          m.file_id === activeFile.id && (m.action === 'custom' || m.action === 'split'),
      );
      const otherFiles = prev.filter((m) => m.file_id !== activeFile.id);
      const merged: MappingRow[] = [...otherFiles, ...preserved];
      for (const row of next) {
        const prevRow = prev.find(
          (p) => p.file_id === row.file_id && p.source_column === row.source_column,
        );
        merged.push({
          file_id: row.file_id,
          source_column: row.source_column,
          target_field: row.target_field,
          action: row.action,
          ai_confidence: row.ai_confidence ?? null,
          ai_suggested: row.ai_suggested ?? false,
          user_overridden: prevRow ? true : undefined,
        });
      }
      return merged;
    });
  }

  async function saveAndContinue() {
    setSaving(true);
    setError(null);
    try {
      const deduped = [
        ...new Map(mappings.map((m) => [`${m.file_id}::${m.source_column}`, m])).values(),
      ];
      const res = await fetch(`/api/import/sessions/${sessionId}/mappings/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mappings: deduped }),
      });
      const j = await readResponseJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(j.error ?? 'Save failed');
      window.location.href = `/dashboard/import/${sessionId}/review`;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    }
    setSaving(false);
  }

  async function runAiForFile(fileId: string) {
    setAiBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/import/sessions/${sessionId}/files/${fileId}/ai-map`, { method: 'POST' });
      const j = await readResponseJson<{ error?: string; message?: string }>(res);
      if (!res.ok) throw new Error(j.error ?? 'AI mapping failed');
      await load();
      if (j.message) setBanner(j.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI mapping failed');
    }
    setAiBusy(false);
  }

  const canContinue = useMemo(() => {
    for (const f of files) {
      const mapped = new Set(
        mappings.filter((m) => m.file_id === f.id && m.action === 'map' && m.target_field).map((m) => m.target_field),
      );
      const hasSplitName = mappings.some((m) => m.file_id === f.id && m.action === 'split');
      if (f.file_type === 'clients' || f.file_type === 'unknown') {
        const hasFirst = mapped.has('first_name');
        const hasLast = mapped.has('last_name');
        const hasFull = mapped.has('full_name');
        if (!(hasFirst && hasLast) && !hasFull && !hasSplitName) return false;
      }
      if (f.file_type === 'bookings') {
        const hasEmail = mapped.has('client_email');
        const hasPhone = mapped.has('client_phone');
        const hasExternalClient = mapped.has('client_external_id');
        if (!hasEmail && !hasPhone && !hasExternalClient) return false;
        if (!mapped.has('booking_date') || !mapped.has('booking_time')) return false;
      }
    }
    return files.length > 0;
  }, [files, mappings]);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Map columns</h1>
        <p className="mt-1 text-sm text-slate-500">
          Drag CSV columns onto {clientLabel.toLowerCase()} or booking fields, or use the dropdowns. Run AI if the
          source is unfamiliar.
        </p>
      </div>

      {banner && (
        <div className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-900">{banner}</div>
      )}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
      )}

      <div className="flex flex-wrap gap-2">
        {files.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setActiveFileId(f.id)}
            className={`min-h-10 rounded-lg px-3 py-2 text-sm font-semibold ${
              activeFile?.id === f.id ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            {f.filename}
          </button>
        ))}
      </div>

      {activeFile && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-slate-800">{activeFile.filename}</p>
            <button
              type="button"
              disabled={aiBusy}
              onClick={() => void runAiForFile(activeFile.id)}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-70"
            >
              {aiBusy ?
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" aria-hidden />
              : null}
              {aiBusy ? 'Running AI…' : 'Run AI mapping'}
            </button>
          </div>

          <ImportMapDndView
            fileId={activeFile.id}
            headers={activeFile.headers ?? []}
            sampleRows={activeFile.sample_rows}
            targetFields={targetOptions}
            mappings={dndMappingsForActive}
            columnDetails={columnDetailsForActive}
            clientLabel={clientLabel}
            onMappingsChange={handleDndChange}
            onCreateCustomField={handleCreateCustomField}
          />
        </div>
      )}

      <div className="flex justify-between gap-2">
        <Link
          href={`/dashboard/import/${sessionId}/upload`}
          className="inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Back
        </Link>
        <button
          type="button"
          disabled={saving || !canContinue}
          onClick={() => void saveAndContinue()}
          className="min-h-10 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Continue'}
        </button>
      </div>
      {!canContinue && (
        <p className="text-xs text-amber-700">
          Map required fields: for {clientLabel.toLowerCase()} lists, first + last name (or full name); for bookings,
          date + time + email, phone, or external client ID.
        </p>
      )}
    </div>
  );
}
