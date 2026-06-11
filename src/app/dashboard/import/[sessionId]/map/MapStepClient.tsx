'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { readResponseJson } from '@/lib/api/read-response-json';
import { targetFieldsForFileType } from '@/lib/import/constants';
import {
  computeAllFileRequirements,
  type FileRequirements,
  type RequirementMapping,
} from '@/lib/import/map-requirements';
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
  split_config?: { separator?: string; parts?: Array<{ field: string }> } | null;
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

type SplitDraft = {
  source: string;
  separator: string;
  parts: string[];
};

const DATETIME_SAMPLE_RE =
  /^(\d{4}-\d{2}-\d{2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})[T ]\d{1,2}[:.]\d{2}/;

const DATA_FILE_TYPES = new Set(['clients', 'bookings', 'staff', 'unknown']);

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
  const [splitDraft, setSplitDraft] = useState<SplitDraft | null>(null);
  const [instructions, setInstructions] = useState('');
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [instructionsBusy, setInstructionsBusy] = useState(false);

  const load = useCallback(async (): Promise<{ files: ImportFile[]; mappings: MappingRow[] }> => {
    const res = await fetch(`/api/import/sessions/${sessionId}`);
    const data = await readResponseJson<{
      files?: ImportFile[];
      mappings?: MappingRow[];
      session?: { ai_mapping_used?: boolean; session_settings?: { ai_instructions?: string | null } };
      error?: string;
    }>(res);
    if (!res.ok) throw new Error(data.error ?? 'Failed to load');
    setFiles(data.files ?? []);
    setMappings(data.mappings ?? []);
    if (data.files?.[0]?.id) setActiveFileId((prev) => prev ?? data.files![0]!.id);
    const savedInstructions = data.session?.session_settings?.ai_instructions;
    if (typeof savedInstructions === 'string') {
      setInstructions((prev) => (prev ? prev : savedInstructions));
      if (savedInstructions.trim()) setInstructionsOpen(true);
    }
    if (data.session?.ai_mapping_used) {
      setBanner('We pre-filled mappings from your column headers. Review them below before continuing.');
    }
    return { files: data.files ?? [], mappings: data.mappings ?? [] };
  }, [sessionId]);

  /**
   * Auto-map on arrival: any data file with no mappings at all (unrecognised
   * platform, so no template applied) gets one automatic AI mapping run —
   * the user shouldn't have to know a "Run AI mapping" button exists.
   */
  const autoMapAttempted = useRef(false);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const { files: loadedFiles, mappings: loadedMappings } = await load();
        if (!autoMapAttempted.current) {
          autoMapAttempted.current = true;
          const mappedFileIds = new Set(loadedMappings.map((m) => m.file_id));
          const unmapped = loadedFiles.filter(
            (f) => !mappedFileIds.has(f.id) && DATA_FILE_TYPES.has(f.file_type),
          );
          if (unmapped.length > 0) {
            setAiBusy(true);
            setBanner('Mapping your columns automatically…');
            let anyMapped = false;
            for (const f of unmapped) {
              const res = await fetch(`/api/import/sessions/${sessionId}/files/${f.id}/ai-map`, {
                method: 'POST',
              });
              const j = await readResponseJson<{ ok?: boolean }>(res);
              if (res.ok && j.ok) anyMapped = true;
            }
            await load();
            setBanner(
              anyMapped
                ? 'We mapped your columns automatically. Review them below — anything amber still needs your attention.'
                : 'Automatic mapping was unavailable — map your columns below.',
            );
            setAiBusy(false);
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load');
        setAiBusy(false);
      }
      setLoading(false);
    })();
  }, [load, sessionId]);

  const activeFile = files.find((f) => f.id === activeFileId) ?? files[0] ?? null;

  const targetOptions = useMemo(() => {
    if (!activeFile) return [];
    return targetFieldsForFileType(activeFile.file_type);
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
        split_config: m.split_config ?? null,
      }));
  }, [mappings, activeFile]);

  const requirements: FileRequirements[] = useMemo(
    () => computeAllFileRequirements(files, mappings as RequirementMapping[], clientLabel),
    [files, mappings, clientLabel],
  );

  const activeRequirements = requirements.find((r) => r.fileId === activeFile?.id) ?? null;
  const blockedFiles = requirements.filter((r) => !r.satisfied);
  const canContinue = files.length > 0 && blockedFiles.length === 0;

  function firstSampleValue(source: string): string {
    for (const row of activeFile?.sample_rows ?? []) {
      const v = (row[source] ?? '').trim();
      if (v) return v;
    }
    return '';
  }

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

  /** Sensible split defaults from the file type and the column's sample value. */
  function openSplitEditor(source: string) {
    if (!activeFile) return;
    const existing = mappings.find(
      (m) => m.file_id === activeFile.id && m.source_column === source && m.action === 'split',
    );
    if (existing?.split_config?.parts?.length) {
      setSplitDraft({
        source,
        separator: existing.split_config.separator ?? ' ',
        parts: existing.split_config.parts.map((p) => p.field ?? ''),
      });
      return;
    }
    const sample = firstSampleValue(source);
    const looksDateTime = DATETIME_SAMPLE_RE.test(sample);
    let parts: string[];
    if (activeFile.file_type === 'bookings') {
      parts = looksDateTime ? ['booking_date', 'booking_time'] : ['guest_first_name', 'guest_last_name'];
    } else if (activeFile.file_type === 'staff') {
      parts = ['staff_first_name', 'staff_last_name'];
    } else {
      parts = ['first_name', 'last_name'];
    }
    const separator = !sample.includes(' ') && sample.includes(',') ? ',' : ' ';
    setSplitDraft({ source, separator, parts });
  }

  function saveSplitDraft() {
    if (!activeFile || !splitDraft) return;
    const chosen = splitDraft.parts.filter(Boolean);
    if (chosen.length === 0) return;
    setMappings((prev) => {
      const base = prev.filter(
        (m) => !(m.file_id === activeFile.id && m.source_column === splitDraft.source),
      );
      base.push({
        file_id: activeFile.id,
        source_column: splitDraft.source,
        target_field: null,
        action: 'split',
        split_config: {
          separator: splitDraft.separator || ' ',
          parts: splitDraft.parts.filter(Boolean).map((field) => ({ field })),
        },
        user_overridden: true,
      });
      return base;
    });
    setSplitDraft(null);
  }

  function removeSplit(source: string) {
    if (!activeFile) return;
    setMappings((prev) =>
      prev.filter((m) => !(m.file_id === activeFile.id && m.source_column === source && m.action === 'split')),
    );
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

  /** Persist the user's instructions, then re-run AI mapping on every data file. */
  async function saveInstructionsAndRerun() {
    setInstructionsBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/import/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_settings: { ai_instructions: instructions.trim() || null } }),
      });
      const j = await readResponseJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(j.error ?? 'Could not save instructions');

      setAiBusy(true);
      setBanner('Re-mapping your columns with your instructions…');
      const dataFiles = files.filter((f) => DATA_FILE_TYPES.has(f.file_type));
      for (const f of dataFiles) {
        await fetch(`/api/import/sessions/${sessionId}/files/${f.id}/ai-map`, { method: 'POST' });
      }
      await load();
      setBanner('Columns re-mapped using your instructions. Review the result below.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not apply instructions');
    }
    setAiBusy(false);
    setInstructionsBusy(false);
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  const splitPreview = (() => {
    if (!splitDraft) return null;
    const sample = firstSampleValue(splitDraft.source);
    if (!sample) return null;
    const sep = splitDraft.separator || ' ';
    const segs = sample.split(sep).map((s) => s.trim()).filter(Boolean);
    const lastIdx = splitDraft.parts.length - 1;
    return splitDraft.parts.map((field, i) => ({
      field,
      value: i === lastIdx ? segs.slice(i).join(' ') : segs[i] ?? '',
    }));
  })();

  const fieldLabel = (key: string) =>
    targetOptions.find((f) => f.key === key)?.label ?? key;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Map columns</h1>
        <p className="mt-1 text-sm text-slate-500">
          We matched your columns to Resneo fields automatically — your job is just to check the result. Drag a column
          onto a field to change it, use the dropdowns, or split a combined column (like a full name) into parts.
        </p>
      </div>

      {banner && (
        <div className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-900">{banner}</div>
      )}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white">
        <button
          type="button"
          onClick={() => setInstructionsOpen((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-3 text-left"
        >
          <span className="text-sm font-semibold text-slate-800">
            {instructionsOpen ? '▼' : '▶'} Tell the AI about your data (optional)
          </span>
          <span className="text-xs text-slate-500">e.g. “the Ref column is our client ID”</span>
        </button>
        {instructionsOpen && (
          <div className="space-y-2 border-t border-slate-100 px-4 py-3">
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder={`Anything that helps us map your file correctly — e.g. "Column 'No.' is the client ID from our old system", "the Visits sheet is bookings, dates are American format", "ignore the Balance column".`}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <div className="flex justify-end">
              <button
                type="button"
                disabled={instructionsBusy || aiBusy}
                onClick={() => void saveInstructionsAndRerun()}
                className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:cursor-wait disabled:opacity-70"
              >
                {instructionsBusy ? (
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />
                ) : null}
                {instructionsBusy ? 'Applying…' : 'Save & re-run AI mapping'}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {files.map((f) => {
          const req = requirements.find((r) => r.fileId === f.id);
          const ok = req?.satisfied !== false;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setActiveFileId(f.id)}
              className={`min-h-10 rounded-lg px-3 py-2 text-sm font-semibold ${
                activeFile?.id === f.id ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {ok ? '✓ ' : '⚠ '}
              {f.filename}
            </button>
          );
        })}
      </div>

      {activeFile && activeRequirements && (
        <div
          className={`rounded-xl border p-4 ${
            activeRequirements.satisfied ? 'border-emerald-200 bg-emerald-50/50' : 'border-amber-300 bg-amber-50/60'
          }`}
        >
          <p className="text-sm font-semibold text-slate-900">
            {activeRequirements.satisfied
              ? 'This file has everything it needs.'
              : 'Before you can continue, this file needs:'}
          </p>
          <ul className="mt-2 space-y-1.5">
            {activeRequirements.items.map((item) => (
              <li key={item.key} className="text-sm">
                <span className={item.satisfied ? 'text-emerald-800' : 'text-amber-900'}>
                  {item.satisfied ? '✓' : '✗'} <span className="font-medium">{item.label}</span>
                </span>
                {item.hint && (
                  <p className="ml-5 mt-0.5 text-xs text-slate-600">{item.hint}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

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
              {aiBusy ? 'Running AI…' : 'Re-run AI mapping'}
            </button>
          </div>

          {splitDraft && (
            <div className="space-y-3 rounded-xl border border-indigo-200 bg-indigo-50/60 p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    Split “{splitDraft.source}” into multiple fields
                  </p>
                  <p className="mt-0.5 text-xs text-slate-600">
                    Each part of the value goes to its own field. Name splits are smart — “Smith, John” and compound
                    surnames are handled for you.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSplitDraft(null)}
                  className="text-xs font-medium text-slate-500 hover:text-slate-800"
                >
                  Cancel
                </button>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-0.5">
                  <span className="text-[10px] uppercase tracking-wide text-slate-500">Separator</span>
                  <input
                    className="w-20 rounded border border-slate-200 px-2 py-1 text-xs"
                    value={splitDraft.separator}
                    placeholder="space"
                    onChange={(e) => setSplitDraft((d) => (d ? { ...d, separator: e.target.value } : d))}
                  />
                </label>
                {splitDraft.parts.map((field, idx) => (
                  <label key={idx} className="flex flex-col gap-0.5">
                    <span className="text-[10px] uppercase tracking-wide text-slate-500">Part {idx + 1}</span>
                    <div className="flex items-center gap-1">
                      <select
                        className="rounded border border-slate-200 px-2 py-1 text-xs"
                        value={field}
                        onChange={(e) =>
                          setSplitDraft((d) => {
                            if (!d) return d;
                            const parts = [...d.parts];
                            parts[idx] = e.target.value;
                            return { ...d, parts };
                          })
                        }
                      >
                        <option value="">Select field…</option>
                        {targetOptions.map((f) => (
                          <option key={f.key} value={f.key}>
                            {f.label}
                          </option>
                        ))}
                      </select>
                      {splitDraft.parts.length > 2 && (
                        <button
                          type="button"
                          aria-label={`Remove part ${idx + 1}`}
                          onClick={() =>
                            setSplitDraft((d) =>
                              d ? { ...d, parts: d.parts.filter((_, i) => i !== idx) } : d,
                            )
                          }
                          className="text-xs text-slate-400 hover:text-red-600"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </label>
                ))}
                <button
                  type="button"
                  onClick={() => setSplitDraft((d) => (d ? { ...d, parts: [...d.parts, ''] } : d))}
                  className="text-xs font-medium text-brand-700 hover:text-brand-800"
                >
                  + Add part
                </button>
              </div>
              {splitPreview && splitPreview.some((p) => p.field) && (
                <div className="rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs text-slate-700">
                  <p className="font-semibold text-slate-800">Preview (first row):</p>
                  <ul className="mt-1 space-y-0.5">
                    {splitPreview
                      .filter((p) => p.field)
                      .map((p, i) => (
                        <li key={i}>
                          <span className="font-medium">{fieldLabel(p.field)}</span> ← “{p.value || '—'}”
                        </li>
                      ))}
                  </ul>
                </div>
              )}
              <div className="flex justify-end">
                <button
                  type="button"
                  disabled={!splitDraft.parts.some(Boolean)}
                  onClick={saveSplitDraft}
                  className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  Apply split
                </button>
              </div>
            </div>
          )}

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
            onRequestSplit={openSplitEditor}
            onRemoveSplit={removeSplit}
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
      {!canContinue && blockedFiles.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
          <p className="font-semibold">Almost there — these files still need something:</p>
          <ul className="mt-1 list-inside list-disc space-y-0.5">
            {blockedFiles.map((bf) => (
              <li key={bf.fileId}>
                <button
                  type="button"
                  onClick={() => setActiveFileId(bf.fileId)}
                  className="font-medium underline decoration-amber-400 underline-offset-2 hover:text-amber-800"
                >
                  {bf.filename}
                </button>
                : {bf.items.filter((i) => !i.satisfied).map((i) => i.label).join(', ')}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
