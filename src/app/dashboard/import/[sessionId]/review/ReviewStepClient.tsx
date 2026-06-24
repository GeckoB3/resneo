'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { readResponseJson } from '@/lib/api/read-response-json';
import { targetFieldsForFileType, type SchemaField } from '@/lib/import/constants';
import { useImportTerminology } from '@/components/import/ImportTerminologyContext';
import {
  canonicalValuesForTarget,
  isValueMapTarget,
  VALUE_MAP_TARGETS,
} from '@/lib/import/value-map';

type ImportFile = {
  id: string;
  filename: string;
  file_type: string;
  sample_rows?: Record<string, string>[] | null;
};

type MappingRow = {
  id: string;
  file_id: string;
  source_column: string;
  target_field: string | null;
  action: string;
  custom_field_name?: string | null;
  custom_field_type?: string | null;
  split_config?: {
    separator?: string;
    parts?: Array<{ field: string }>;
  } | null;
  value_map?: Record<string, string> | null;
};

/** One editable row in a value-mapping panel: a raw source value → canonical choice. */
type ValueMapEntry = { from: string; to: string };

function fieldListForFile(fileType: string): SchemaField[] {
  return targetFieldsForFileType(fileType);
}

function labelForField(key: string | null | undefined, fileType: string): string {
  if (!key) return '—';
  const list = fieldListForFile(fileType);
  return list.find((f) => f.key === key)?.label ?? key;
}

/** Plain-English label for the column action (raw values are dev tokens). */
const ACTION_LABELS: Record<string, string> = {
  map: 'Imported',
  ignore: 'Not imported',
  custom: 'Custom field',
  split: 'Split into fields',
};

function labelForAction(action: string): string {
  return ACTION_LABELS[action] ?? action.replace(/_/g, ' ');
}

export function ReviewStepClient({ sessionId }: { sessionId: string }) {
  const { clientLabel } = useImportTerminology();
  const [files, setFiles] = useState<ImportFile[]>([]);
  const [mappings, setMappings] = useState<MappingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const [customDraft, setCustomDraft] = useState<Record<string, { name: string; type: string }>>({});
  const [splitDraft, setSplitDraft] = useState<
    Record<string, { separator: string; parts: Array<{ field: string }> }>
  >({});
  // Per-mapping working copy of the value-mapping rows; seeded from the saved
  // value_map on first edit. Keyed by mapping id; undefined means "not yet touched".
  const [valueMapDraft, setValueMapDraft] = useState<Record<string, ValueMapEntry[]>>({});
  // Mapping ids whose value mapping saved successfully since the last edit (for the "Saved" hint).
  const [valueMapSaved, setValueMapSaved] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    const res = await fetch(`/api/import/sessions/${sessionId}`);
    const data = await readResponseJson<{
      files?: ImportFile[];
      mappings?: MappingRow[];
      error?: string;
    }>(res);
    if (!res.ok) throw new Error(data.error ?? 'Failed to load');
    setFiles(data.files ?? []);
    setMappings(data.mappings ?? []);
  }, [sessionId]);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load');
      }
      setLoading(false);
    })();
  }, [load]);

  const byFile = useMemo(() => {
    const map = new Map<string, MappingRow[]>();
    for (const m of mappings) {
      const list = map.get(m.file_id) ?? [];
      list.push(m);
      map.set(m.file_id, list);
    }
    return map;
  }, [mappings]);

  async function saveCustom(mappingId: string) {
    const m = mappings.find((x) => x.id === mappingId);
    const draft = customDraft[mappingId] ?? {
      name: m?.custom_field_name ?? '',
      type: m?.custom_field_type ?? 'text',
    };
    if (!draft.name.trim()) return;
    setSavingId(mappingId);
    setError(null);
    try {
      const res = await fetch(`/api/import/sessions/${sessionId}/mappings/${mappingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'custom',
          custom_field_name: draft.name.trim(),
          custom_field_type: draft.type,
          user_overridden: true,
        }),
      });
      const j = await readResponseJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(j.error ?? 'Save failed');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    }
    setSavingId(null);
  }

  async function saveSplit(mappingId: string, fileType: string) {
    const m = mappings.find((x) => x.id === mappingId);
    const draft =
      splitDraft[mappingId] ??
      (m?.split_config ?
        {
          separator: m.split_config.separator ?? ' ',
          parts: m.split_config.parts?.map((p) => ({ field: p.field ?? '' })) ?? [{ field: '' }],
        }
      : null);
    if (!draft?.parts.length) return;
    const allowed = new Set(fieldListForFile(fileType).map((f) => f.key));
    const parts = draft.parts.filter((p) => p.field && allowed.has(p.field));
    if (!parts.length) return;
    setSavingId(mappingId);
    setError(null);
    try {
      const res = await fetch(`/api/import/sessions/${sessionId}/mappings/${mappingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'split',
          split_config: {
            separator: draft.separator || ' ',
            parts,
          },
          user_overridden: true,
        }),
      });
      const j = await readResponseJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(j.error ?? 'Save failed');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    }
    setSavingId(null);
  }

  function ensureCustomDraft(m: MappingRow) {
    if (customDraft[m.id]) return;
    setCustomDraft((prev) => ({
      ...prev,
      [m.id]: {
        name: m.custom_field_name ?? '',
        type: m.custom_field_type ?? 'text',
      },
    }));
  }

  function ensureSplitDraft(m: MappingRow) {
    if (splitDraft[m.id]) return;
    const parts = m.split_config?.parts?.length ? m.split_config.parts : [{ field: '' }];
    setSplitDraft((prev) => ({
      ...prev,
      [m.id]: {
        separator: m.split_config?.separator ?? ' ',
        parts: parts.map((p) => ({ field: p.field ?? '' })),
      },
    }));
  }

  /** Current value-mapping rows for a mapping: the live draft if edited, else the saved map. */
  function valueMapRowsFor(m: MappingRow): ValueMapEntry[] {
    const draft = valueMapDraft[m.id];
    if (draft) return draft;
    return Object.entries(m.value_map ?? {}).map(([from, to]) => ({ from, to }));
  }

  /** Seed (once) and update the working copy of a mapping's value rows. */
  function updateValueMapRows(m: MappingRow, next: (rows: ValueMapEntry[]) => ValueMapEntry[]) {
    setValueMapSaved((prev) => (prev[m.id] ? { ...prev, [m.id]: false } : prev));
    setValueMapDraft((prev) => {
      const current = prev[m.id] ?? Object.entries(m.value_map ?? {}).map(([from, to]) => ({ from, to }));
      return { ...prev, [m.id]: next(current) };
    });
  }

  async function saveValueMap(m: MappingRow) {
    // Build {raw: canonical} from the current rows; drop blank raw values and de-dupe
    // by trimmed raw key (last wins). The endpoint sanitises canonical values again.
    const rows = valueMapRowsFor(m);
    const map: Record<string, string> = {};
    for (const r of rows) {
      const from = r.from.trim();
      if (!from || !r.to) continue;
      map[from] = r.to;
    }
    const value_map = Object.keys(map).length ? map : null;
    setSavingId(m.id);
    setError(null);
    try {
      const res = await fetch(`/api/import/sessions/${sessionId}/mappings/${m.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value_map }),
      });
      const j = await readResponseJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(j.error ?? 'Save failed');
      await load();
      // Drop the local draft so the panel reflects the freshly saved (and server-sanitised) map.
      setValueMapDraft((prev) => {
        const { [m.id]: _drop, ...rest } = prev;
        return rest;
      });
      setValueMapSaved((prev) => ({ ...prev, [m.id]: true }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    }
    setSavingId(null);
  }

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
        <h1 className="text-xl font-semibold text-slate-900">Review</h1>
        <p className="mt-1 text-sm text-slate-500">
          Confirm how each CSV column is used — including custom profile fields and split columns — before we validate
          rows.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
      )}

      {files.length === 0 ? (
        <p className="text-sm text-slate-600">No files uploaded yet. Go back and add CSV files first.</p>
      ) : (
        <div className="space-y-8">
          {files.map((file) => {
            const rows = byFile.get(file.id) ?? [];
            return (
              <section key={file.id} className="rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-100 px-4 py-3">
                  <h2 className="text-sm font-semibold text-slate-900">{file.filename}</h2>
                  <p className="text-xs text-slate-500 capitalize">{file.file_type.replace(/_/g, ' ')}</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 text-xs text-slate-500">
                        <th className="px-4 py-2 font-medium">Column</th>
                        <th className="px-4 py-2 font-medium">Sample</th>
                        <th className="px-4 py-2 font-medium">Action</th>
                        <th className="px-4 py-2 font-medium">Detail</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((m) => {
                        const sample0 = (file.sample_rows?.[0] ?? {}) as Record<string, string>;
                        const splitParts =
                          splitDraft[m.id]?.parts ?? m.split_config?.parts?.map((p) => ({ field: p.field ?? '' })) ?? [
                            { field: '' },
                          ];
                        return (
                        <tr key={m.id} className="border-b border-slate-50 align-top">
                          <td className="px-4 py-3 font-mono text-xs text-slate-800">{m.source_column}</td>
                          <td className="max-w-[10rem] px-4 py-3 text-xs text-slate-600" title={sample0[m.source_column]}>
                            {sample0[m.source_column]?.trim() || '—'}
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-700">{labelForAction(m.action)}</td>
                          <td className="px-4 py-3 text-xs text-slate-700">
                            {m.action === 'map' && (
                              <div className="space-y-3">
                                <span>{labelForField(m.target_field, file.file_type)}</span>
                                {isValueMapTarget(m.target_field) && m.target_field && (
                                  <ValueMapPanel
                                    target={m.target_field}
                                    sourceColumn={m.source_column}
                                    rows={valueMapRowsFor(m)}
                                    saving={savingId === m.id}
                                    saved={Boolean(valueMapSaved[m.id])}
                                    onChangeRow={(idx, to) =>
                                      updateValueMapRows(m, (rows) =>
                                        rows.map((r, i) => (i === idx ? { ...r, to } : r)),
                                      )
                                    }
                                    onRemoveRow={(idx) =>
                                      updateValueMapRows(m, (rows) => rows.filter((_, i) => i !== idx))
                                    }
                                    onAddRow={(from, to) =>
                                      updateValueMapRows(m, (rows) => [...rows, { from, to }])
                                    }
                                    onSave={() => void saveValueMap(m)}
                                  />
                                )}
                              </div>
                            )}
                            {m.action === 'ignore' && <span className="text-slate-500">Not imported</span>}
                            {m.action === 'custom' && (
                              <div className="space-y-2">
                                <p className="text-slate-600">
                                  Stored on the {clientLabel.toLowerCase()} profile as a custom field.
                                </p>
                                <div className="flex flex-wrap items-end gap-2">
                                  <label className="flex flex-col gap-0.5">
                                    <span className="text-[10px] uppercase tracking-wide text-slate-500">Label</span>
                                    <input
                                      className="rounded border border-slate-200 px-2 py-1 text-xs"
                                      value={customDraft[m.id]?.name ?? m.custom_field_name ?? ''}
                                      onFocus={() => ensureCustomDraft(m)}
                                      onChange={(e) => {
                                        setCustomDraft((prev) => ({
                                          ...prev,
                                          [m.id]: {
                                            name: e.target.value,
                                            type: prev[m.id]?.type ?? m.custom_field_type ?? 'text',
                                          },
                                        }));
                                      }}
                                    />
                                  </label>
                                  <label className="flex flex-col gap-0.5">
                                    <span className="text-[10px] uppercase tracking-wide text-slate-500">Type</span>
                                    <select
                                      className="rounded border border-slate-200 px-2 py-1 text-xs"
                                      value={customDraft[m.id]?.type ?? m.custom_field_type ?? 'text'}
                                      onFocus={() => ensureCustomDraft(m)}
                                      onChange={(e) => {
                                        setCustomDraft((prev) => ({
                                          ...prev,
                                          [m.id]: {
                                            name: prev[m.id]?.name ?? m.custom_field_name ?? '',
                                            type: e.target.value,
                                          },
                                        }));
                                      }}
                                    >
                                      <option value="text">Text</option>
                                      <option value="number">Number</option>
                                      <option value="date">Date</option>
                                      <option value="boolean">Yes / No</option>
                                    </select>
                                  </label>
                                  <button
                                    type="button"
                                    disabled={savingId === m.id}
                                    onClick={() => void saveCustom(m.id)}
                                    className="rounded-lg bg-slate-800 px-2 py-1 text-xs font-semibold text-white hover:bg-slate-900 disabled:opacity-50"
                                  >
                                    {savingId === m.id ? 'Saving…' : 'Save'}
                                  </button>
                                </div>
                              </div>
                            )}
                            {m.action === 'split' && (
                              <div className="space-y-2">
                                <p className="text-slate-600">
                                  One cell is split into multiple {clientLabel.toLowerCase()} fields.
                                </p>
                                <div className="flex flex-wrap items-end gap-2">
                                  <label className="flex flex-col gap-0.5">
                                    <span className="text-[10px] uppercase tracking-wide text-slate-500">Separator</span>
                                    <input
                                      className="w-24 rounded border border-slate-200 px-2 py-1 text-xs"
                                      placeholder="space"
                                      value={splitDraft[m.id]?.separator ?? m.split_config?.separator ?? ' '}
                                      onFocus={() => ensureSplitDraft(m)}
                                      onChange={(e) => {
                                        ensureSplitDraft(m);
                                        setSplitDraft((prev) => ({
                                          ...prev,
                                          [m.id]: { ...prev[m.id]!, separator: e.target.value },
                                        }));
                                      }}
                                    />
                                  </label>
                                </div>
                                <div className="space-y-1">
                                  {splitParts.map((part, idx) => (
                                      <div key={idx} className="flex flex-wrap items-center gap-2">
                                        <span className="text-[10px] text-slate-500">Part {idx + 1}</span>
                                        <select
                                          className="rounded border border-slate-200 px-2 py-1 text-xs"
                                          value={part.field}
                                          onFocus={() => ensureSplitDraft(m)}
                                          onChange={(e) => {
                                            ensureSplitDraft(m);
                                            setSplitDraft((prev) => {
                                              const cur = prev[m.id] ?? {
                                                separator: m.split_config?.separator ?? ' ',
                                                parts: m.split_config?.parts?.map((p) => ({ field: p.field ?? '' })) ?? [
                                                  { field: '' },
                                                ],
                                              };
                                              const nextParts = [...cur.parts];
                                              nextParts[idx] = { field: e.target.value };
                                              return { ...prev, [m.id]: { ...cur, parts: nextParts } };
                                            });
                                          }}
                                        >
                                          <option value="">Select field…</option>
                                          {fieldListForFile(file.file_type).map((f) => (
                                            <option key={f.key} value={f.key}>
                                              {f.label}
                                            </option>
                                          ))}
                                        </select>
                                      </div>
                                    ))}
                                  <button
                                    type="button"
                                    className="text-xs font-medium text-brand-700 hover:text-brand-800"
                                    onClick={() => {
                                      ensureSplitDraft(m);
                                      setSplitDraft((prev) => {
                                        const cur = prev[m.id] ?? {
                                          separator: m.split_config?.separator ?? ' ',
                                          parts: [{ field: '' }],
                                        };
                                        return {
                                          ...prev,
                                          [m.id]: { ...cur, parts: [...cur.parts, { field: '' }] },
                                        };
                                      });
                                    }}
                                  >
                                    + Add part
                                  </button>
                                </div>
                                <button
                                  type="button"
                                  disabled={savingId === m.id}
                                  onClick={() => void saveSplit(m.id, file.file_type)}
                                  className="rounded-lg bg-slate-800 px-2 py-1 text-xs font-semibold text-white hover:bg-slate-900 disabled:opacity-50"
                                >
                                  {savingId === m.id ? 'Saving…' : 'Save split'}
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </div>
      )}

      <p className="text-xs text-slate-500">
        To change standard column targets or drag columns onto fields, use the Map step. Custom and split rules you save
        here are applied during validation and import.
      </p>

      <div className="flex justify-between">
        <Link
          href={`/dashboard/import/${sessionId}/map`}
          className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Back
        </Link>
        <Link
          href={`/dashboard/import/${sessionId}/references`}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
        >
          Continue
        </Link>
      </div>
    </div>
  );
}

/**
 * Editable panel that shows how a column's raw values map to the standard values
 * for a field (e.g. booking status). The user can change a value, remove a row,
 * or add one the AI missed. The parent owns the saved rows; this component owns
 * only the "add a value" input state and reports edits back via callbacks.
 */
function ValueMapPanel({
  target,
  sourceColumn,
  rows,
  saving,
  saved,
  onChangeRow,
  onRemoveRow,
  onAddRow,
  onSave,
}: {
  target: string;
  sourceColumn: string;
  rows: ValueMapEntry[];
  saving: boolean;
  saved: boolean;
  onChangeRow: (idx: number, to: string) => void;
  onRemoveRow: (idx: number) => void;
  onAddRow: (from: string, to: string) => void;
  onSave: () => void;
}) {
  const label = VALUE_MAP_TARGETS[target]?.label ?? 'standard values';
  const choices = canonicalValuesForTarget(target);
  const [newFrom, setNewFrom] = useState('');
  const [newTo, setNewTo] = useState('');
  const addRowId = `value-map-add-${target}-${sourceColumn}`;

  function handleAdd() {
    const from = newFrom.trim();
    if (!from || !newTo) return;
    onAddRow(from, newTo);
    setNewFrom('');
    setNewTo('');
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs font-semibold text-slate-700">
        How your “{sourceColumn}” values map to {label.toLowerCase()}
      </p>
      <p className="mt-0.5 text-[11px] leading-snug text-slate-500">
        We matched these values automatically — change any that look wrong. Values not listed here are matched
        automatically.
      </p>

      {rows.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {rows.map((row, idx) => {
            const selectId = `value-map-${target}-${sourceColumn}-${idx}`;
            return (
              <li key={idx} className="flex flex-wrap items-center gap-2">
                <span
                  className="max-w-[8rem] truncate rounded border border-slate-200 bg-white px-2 py-1 font-mono text-xs text-slate-800"
                  title={row.from}
                >
                  {row.from}
                </span>
                <span aria-hidden className="text-slate-400">
                  →
                </span>
                <label className="sr-only" htmlFor={selectId}>
                  {label} for “{row.from}”
                </label>
                <select
                  id={selectId}
                  className="rounded border border-slate-200 bg-white px-2 py-1 text-xs"
                  value={choices.includes(row.to) ? row.to : ''}
                  onChange={(e) => onChangeRow(idx, e.target.value)}
                >
                  {!choices.includes(row.to) && <option value="">Choose a value…</option>}
                  {choices.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => onRemoveRow(idx)}
                  className="rounded px-1.5 py-1 text-xs font-medium text-slate-500 hover:bg-slate-200 hover:text-slate-700"
                  aria-label={`Remove the mapping for “${row.from}”`}
                >
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-3 border-t border-slate-200 pt-3">
        <p className="text-[10px] uppercase tracking-wide text-slate-500">Add a value</p>
        <div className="mt-1 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-0.5">
            <span className="sr-only" id={`${addRowId}-from-label`}>
              Value from your file
            </span>
            <input
              id={`${addRowId}-from`}
              aria-labelledby={`${addRowId}-from-label`}
              className="w-28 rounded border border-slate-200 bg-white px-2 py-1 text-xs"
              placeholder="Value in your file"
              value={newFrom}
              onChange={(e) => setNewFrom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAdd();
                }
              }}
            />
          </label>
          <span aria-hidden className="pb-1 text-slate-400">
            →
          </span>
          <label className="flex flex-col gap-0.5">
            <span className="sr-only">Maps to {label.toLowerCase()}</span>
            <select
              id={`${addRowId}-to`}
              className="rounded border border-slate-200 bg-white px-2 py-1 text-xs"
              value={newTo}
              onChange={(e) => setNewTo(e.target.value)}
            >
              <option value="">Choose a value…</option>
              {choices.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={handleAdd}
            disabled={!newFrom.trim() || !newTo}
            className="text-xs font-medium text-brand-700 hover:text-brand-800 disabled:opacity-40"
          >
            + Add
          </button>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          disabled={saving}
          onClick={onSave}
          className="rounded-lg bg-slate-800 px-2.5 py-1 text-xs font-semibold text-white hover:bg-slate-900 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save value mapping'}
        </button>
        {saved && !saving && <span className="text-xs text-emerald-600">Saved</span>}
      </div>
    </div>
  );
}
