'use client';

import { useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import type { SchemaField } from '@/lib/import/constants';

export type MapDndMapping = {
  file_id: string;
  source_column: string;
  target_field: string | null;
  action: string;
  ai_confidence?: string | null;
  ai_suggested?: boolean;
};

export type ColumnDetail = {
  source_column: string;
  action: string;
  target_field?: string | null;
  ai_confidence?: string | null;
};

type Props = {
  fileId: string;
  headers: string[];
  sampleRows: Record<string, string>[] | null;
  targetFields: SchemaField[];
  mappings: MapDndMapping[];
  /** Full mapping actions per column (custom, split, etc.). */
  columnDetails?: ColumnDetail[];
  clientLabel: string;
  onMappingsChange: (next: MapDndMapping[]) => void;
  /** Drag or tap-select a column, then drop here to store as a custom profile field. */
  onCreateCustomField?: (sourceColumn: string) => void;
};

function DraggableColumn({
  id,
  label,
  sample,
  confidence,
  selected,
  onSelect,
  mappedToLabel,
}: {
  id: string;
  label: string;
  sample: string;
  confidence?: 'high' | 'medium' | 'low' | null;
  selected: boolean;
  onSelect: () => void;
  mappedToLabel?: string | null;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id,
    data: { type: 'column', sourceColumn: label },
  });

  const style = transform ?
    {
      transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
    }
  : undefined;

  const ring =
    selected ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-200'
    : confidence === 'high' ? 'border-emerald-300 bg-emerald-50/80'
    : confidence === 'medium' ? 'border-amber-300 bg-amber-50/80'
    : confidence === 'low' ? 'border-red-200 bg-red-50/50'
    : 'border-slate-200 bg-white';

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`relative cursor-grab touch-none rounded-lg border p-3 shadow-sm transition-shadow active:cursor-grabbing ${ring} ${
        isDragging ? 'opacity-60' : ''
      } ${mappedToLabel ? 'border-l-4 border-l-brand-500' : ''}`}
    >
      <div className="flex items-start gap-2">
        <span className="text-slate-400 select-none" aria-hidden>
          ⠿
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-900">{label}</p>
          <p className="mt-1 truncate text-xs text-slate-500">{sample || '—'}</p>
          {mappedToLabel && (
            <p className="mt-1 text-[10px] font-medium text-brand-800">→ {mappedToLabel}</p>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
        className="mt-2 w-full cursor-pointer rounded border border-slate-200 py-1 text-[10px] font-semibold text-slate-700 hover:bg-slate-50 md:hidden"
      >
        {selected ? 'Selected — tap a field' : 'Select for mapping'}
      </button>
    </div>
  );
}

function StaticColumnCard({
  label,
  sample,
  kind,
}: {
  label: string;
  sample: string;
  kind: 'custom' | 'split';
}) {
  return (
    <div
      className={`rounded-lg border border-violet-200 bg-violet-50/60 p-3 shadow-sm ${
        kind === 'split' ? 'border-indigo-200 bg-indigo-50/60' : ''
      }`}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-800">
        {kind === 'split' ? 'Split' : 'Custom field'}
      </p>
      <p className="text-sm font-medium text-slate-900">{label}</p>
      <p className="mt-1 truncate text-xs text-slate-600">{sample || '—'}</p>
      <p className="mt-2 text-[10px] text-slate-500">Adjust details on the Review step.</p>
    </div>
  );
}

function DroppableTarget({
  id,
  field,
  mappedSource,
  isConfirmed,
  clientLabel,
  onClear,
  onConfirm,
  onSelect,
  selectValue,
  options,
  selectedSource,
}: {
  id: string;
  field: SchemaField;
  mappedSource: string | null;
  isConfirmed: boolean;
  clientLabel: string;
  onClear: () => void;
  onConfirm: () => void;
  onSelect: (value: string) => void;
  selectValue: string;
  options: { value: string; label: string }[];
  selectedSource: string | null;
}) {
  const { isOver, setNodeRef } = useDroppable({ id });

  const label =
    field.key.includes('client') ||
    field.key.startsWith('guest_') ||
    field.key === 'first_name' ||
    field.key === 'last_name' ||
    field.key === 'full_name' ?
      field.label.replace(/\bClient\b/gi, clientLabel)
    : field.label;

  const pairHighlight = Boolean(selectedSource && mappedSource && mappedSource === selectedSource);

  return (
    <div
      ref={setNodeRef}
      className={`rounded-lg border-2 border-dashed p-3 transition-colors ${
        pairHighlight ? 'border-brand-500 bg-brand-50/50'
        : isOver ? 'border-brand-500 bg-brand-50/60'
        : 'border-slate-200 bg-slate-50/50'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-slate-900">
            {label}
            {field.required ? <span className="text-red-500"> *</span> : null}
          </p>
          <p className="text-xs text-slate-500">{field.type}</p>
        </div>
        {mappedSource && (
          <div className="flex shrink-0 items-center gap-2">
            {isConfirmed ?
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                Confirmed
              </span>
            : <button
                type="button"
                onClick={onConfirm}
                className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-emerald-700"
              >
                Confirm
              </button>}
            <button
              type="button"
              onClick={onClear}
              className="text-xs font-medium text-slate-500 hover:text-slate-800"
            >
              Clear
            </button>
          </div>
        )}
      </div>
      <button
        type="button"
        className="mt-2 min-h-[2rem] w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-left text-xs"
        onClick={() => {
          if (selectedSource) onSelect(selectedSource);
        }}
      >
        {mappedSource ?
          <span className="font-medium text-brand-800">{mappedSource}</span>
        : <span className="text-slate-400">Drop a column here or choose below</span>}
      </button>
      <select
        value={selectValue}
        onChange={(e) => onSelect(e.target.value)}
        className="mt-2 w-full rounded border border-slate-200 px-2 py-1 text-xs"
        aria-label={`Map to ${label}`}
      >
        <option value="">—</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function CustomFieldDropZone({ disabled }: { disabled?: boolean }) {
  const { setNodeRef, isOver } = useDroppable({
    id: 'drop-custom-field',
    disabled: Boolean(disabled),
  });
  return (
    <div
      ref={setNodeRef}
      className={`rounded-lg border-2 border-dashed px-3 py-4 text-center text-xs transition-colors ${
        disabled ? 'cursor-not-allowed border-slate-100 text-slate-400'
        : isOver ? 'border-violet-500 bg-violet-50 text-violet-900'
        : 'border-violet-200 text-violet-900'
      }`}
    >
      <p className="font-semibold">Custom profile field</p>
      <p className="mt-1 text-violet-800/90">
        Drop a column here to import values into a new custom {disabled ? '' : 'field'} (review name on next step).
      </p>
    </div>
  );
}

function UnmappedDropZone() {
  const { setNodeRef, isOver } = useDroppable({ id: 'drop-unmapped' });
  return (
    <div
      ref={setNodeRef}
      className={`rounded-lg border-2 border-dashed px-3 py-4 text-center text-xs ${
        isOver ? 'border-slate-500 bg-slate-100' : 'border-slate-200 text-slate-500'
      }`}
    >
      Drop here to unmap / ignore
    </div>
  );
}

export function ImportMapDndView({
  fileId,
  headers,
  sampleRows,
  targetFields,
  mappings,
  columnDetails,
  clientLabel,
  onMappingsChange,
  onCreateCustomField,
}: Props) {
  const [dragLabel, setDragLabel] = useState<string | null>(null);
  const [selectedSource, setSelectedSource] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 5 },
    }),
  );

  const detailBySource = useMemo(() => {
    const m = new Map<string, ColumnDetail>();
    for (const d of columnDetails ?? []) {
      m.set(d.source_column, d);
    }
    return m;
  }, [columnDetails]);

  const fieldLabelByKey = useMemo(() => {
    const o: Record<string, string> = {};
    for (const f of targetFields) o[f.key] = f.label;
    return o;
  }, [targetFields]);

  const targetByFieldKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of mappings) {
      if (row.file_id !== fileId || row.action !== 'map' || !row.target_field) continue;
      map.set(row.target_field, row.source_column);
    }
    return map;
  }, [mappings, fileId]);

  function aiConfidenceForSource(source: string): 'high' | 'medium' | 'low' | null {
    const row = mappings.find((x) => x.file_id === fileId && x.source_column === source);
    const c = row?.ai_confidence;
    if (c === 'high' || c === 'medium' || c === 'low') return c;
    return null;
  }

  function setMappingForSource(source: string, targetKey: string, replaceConfirmed: boolean) {
    if (targetKey && !replaceConfirmed) {
      const existingSource = targetByFieldKey.get(targetKey);
      if (existingSource && existingSource !== source) {
        const ok = window.confirm(
          `This field is already mapped to “${existingSource}”. Replace it with “${source}”? The previous column will become unmapped.`,
        );
        if (!ok) return;
      }
    }

    let next = mappings.filter((m) => !(m.file_id === fileId && m.source_column === source));
    next = next.filter(
      (m) =>
        !(m.file_id === fileId && m.action === 'map' && m.target_field === targetKey && targetKey !== ''),
    );

    if (!targetKey) {
      next.push({
        file_id: fileId,
        source_column: source,
        target_field: null,
        action: 'ignore',
        ai_confidence: null,
        ai_suggested: false,
      });
    } else {
      next.push({
        file_id: fileId,
        source_column: source,
        target_field: targetKey,
        action: 'map',
        ai_confidence: 'high',
        ai_suggested: false,
      });
    }
    setSelectedSource(null);
    onMappingsChange(next);
  }

  function confirmMapping(source: string, targetKey: string) {
    const next = mappings.map((m) => {
      if (m.file_id !== fileId || m.source_column !== source || m.target_field !== targetKey) return m;
      return {
        ...m,
        action: 'map',
        ai_confidence: 'high' as const,
        ai_suggested: false,
      };
    });
    onMappingsChange(next);
  }

  function handleDragStart(event: DragStartEvent) {
    setDragLabel((event.active.data.current?.sourceColumn as string) ?? null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setDragLabel(null);
    const { active, over } = event;
    if (!over) return;

    const sourceColumn = active.data.current?.sourceColumn as string | undefined;
    if (!sourceColumn) return;

    const overId = String(over.id);
    if (overId === 'drop-unmapped') {
      setMappingForSource(sourceColumn, '', true);
      return;
    }
    if (overId === 'drop-custom-field' && onCreateCustomField) {
      onCreateCustomField(sourceColumn);
      setSelectedSource(null);
      return;
    }
    if (overId.startsWith('field-')) {
      const key = overId.slice('field-'.length);
      setMappingForSource(sourceColumn, key, false);
    }
  }

  const headerOptions = useMemo(
    () => headers.map((h) => ({ value: h, label: h })),
    [headers],
  );

  const { customSplit, dndSections } = useMemo(() => {
    const cs: string[] = [];
    const mappedOk: string[] = [];
    const needsAttention: string[] = [];
    const ignored: string[] = [];

    for (const h of headers) {
      const d = detailBySource.get(h);
      if (d?.action === 'custom' || d?.action === 'split') {
        cs.push(h);
        continue;
      }
      if (d?.action === 'ignore') {
        ignored.push(h);
        continue;
      }
      const isMapped = mappings.some(
        (m) => m.file_id === fileId && m.source_column === h && m.action === 'map' && m.target_field,
      );
      if (isMapped) {
        mappedOk.push(h);
      } else {
        needsAttention.push(h);
      }
    }

    const sections: { title: string; hint: string; items: string[] }[] = [];
    if (mappedOk.length) {
      sections.push({
        title: 'Mapped',
        hint: 'AI or template matches look good.',
        items: mappedOk,
      });
    }
    if (needsAttention.length) {
      sections.push({
        title: 'Needs attention',
        hint: 'Low confidence or not mapped — drag or use dropdowns.',
        items: needsAttention,
      });
    }
    if (ignored.length) {
      sections.push({
        title: 'Ignored',
        hint: 'Not imported.',
        items: ignored,
      });
    }

    return { customSplit: cs, dndSections: sections };
  }, [headers, detailBySource, mappings, fileId]);

  function renderColumnCard(h: string) {
    const id = `col-${fileId}-${encodeURIComponent(h)}`;
    const sample = (sampleRows?.[0] ?? {})[h] ?? '';
    const mappedTarget = mappings.find(
      (m) => m.file_id === fileId && m.source_column === h && m.action === 'map' && m.target_field,
    )?.target_field;
    const mappedLabel = mappedTarget ? fieldLabelByKey[mappedTarget] ?? mappedTarget : null;
    return (
      <DraggableColumn
        key={h}
        id={id}
        label={h}
        sample={sample}
        confidence={aiConfidenceForSource(h)}
        selected={selectedSource === h}
        onSelect={() => setSelectedSource((s) => (s === h ? null : h))}
        mappedToLabel={mappedLabel}
      />
    );
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-800">Your columns</h3>
          <p className="mb-3 text-xs text-slate-500">
            Drag onto a field, use dropdowns, or tap <strong>Select for mapping</strong> (mobile) then tap a field.
            Conflicting mappings ask before replacing.
          </p>

          {customSplit.length > 0 && (
            <div className="mb-4 space-y-2">
              <p className="text-[10px] font-semibold uppercase text-slate-500">Custom &amp; split</p>
              {customSplit.map((h) => {
                const d = detailBySource.get(h);
                const sample = (sampleRows?.[0] ?? {})[h] ?? '';
                return (
                  <StaticColumnCard
                    key={h}
                    label={h}
                    sample={sample}
                    kind={d?.action === 'split' ? 'split' : 'custom'}
                  />
                );
              })}
            </div>
          )}

          {dndSections.length > 0 ?
            dndSections.map((sec) => (
              <div key={sec.title} className="mb-4 space-y-2">
                <p className="text-[10px] font-semibold uppercase text-slate-500">{sec.title}</p>
                <p className="text-[10px] text-slate-500">{sec.hint}</p>
                <div className="space-y-2">{sec.items.map((h) => renderColumnCard(h))}</div>
              </div>
            ))
          : headers.filter((h) => !customSplit.includes(h)).length > 0 ?
            <div className="mb-4 space-y-2">
              <p className="text-[10px] font-semibold uppercase text-slate-500">Columns</p>
              <div className="space-y-2">
                {headers
                  .filter((h) => !customSplit.includes(h))
                  .map((h) => renderColumnCard(h))}
              </div>
            </div>
          : null}

          <div className="mt-4 space-y-3">
            <UnmappedDropZone />
          </div>
        </div>

        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-800">ReserveNI fields</h3>
          <div className="space-y-3">
            {targetFields.map((field) => {
              const mapped = targetByFieldKey.get(field.key) ?? null;
              const mappedRow =
                mapped ?
                  mappings.find(
                    (m) =>
                      m.file_id === fileId &&
                      m.source_column === mapped &&
                      m.action === 'map' &&
                      m.target_field === field.key,
                  )
                : null;
              const selectVal = mapped ?? '';
              return (
                <DroppableTarget
                  key={field.key}
                  id={`field-${field.key}`}
                  field={field}
                  mappedSource={mapped}
                  isConfirmed={Boolean(mappedRow && mappedRow.ai_suggested === false && mappedRow.ai_confidence === 'high')}
                  clientLabel={clientLabel}
                  selectedSource={selectedSource}
                  onClear={() => {
                    if (mapped) setMappingForSource(mapped, '', true);
                  }}
                  onConfirm={() => {
                    if (mapped) confirmMapping(mapped, field.key);
                  }}
                  onSelect={(value) => {
                    if (!value) {
                      if (mapped) setMappingForSource(mapped, '', true);
                      return;
                    }
                    setMappingForSource(value, field.key, false);
                  }}
                  selectValue={selectVal}
                  options={headerOptions}
                />
              );
            })}
          </div>
          {onCreateCustomField ?
            <div className="mt-4">
              <CustomFieldDropZone />
            </div>
          : null}
        </div>
      </div>

      <DragOverlay>
        {dragLabel ?
          <div className="rounded-lg border border-brand-300 bg-white p-3 shadow-lg">
            <p className="text-sm font-medium text-slate-900">{dragLabel}</p>
          </div>
        : null}
      </DragOverlay>
    </DndContext>
  );
}
