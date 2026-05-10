'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { VenueTable, TableShape, TableType } from '@/types/table-management';
import { computeGridPositions, getTableDimensions, TABLE_TYPES } from '@/types/table-management';
import { NumericInput } from '@/components/ui/NumericInput';
import { HorizontalScrollHint } from '@/components/ui/HorizontalScrollHint';

interface Props {
  tables: VenueTable[];
  setTables: (tables: VenueTable[]) => void;
  isAdmin: boolean;
  onRefresh: () => void;
  variant?: 'full' | 'covers';
  /** When set, new tables are created in this dining area (multi-area venues). */
  diningAreaId?: string | null;
}

const SHAPES: { value: TableShape; label: string }[] = [
  { value: 'rectangle', label: 'Rectangle' },
  { value: 'circle', label: 'Circle' },
  { value: 'square', label: 'Square' },
  { value: 'oval', label: 'Oval' },
  { value: 'l-shape', label: 'L-Shape' },
];

interface EditingTable {
  id?: string;
  name: string;
  min_covers: number;
  max_covers: number;
  shape: TableShape;
  table_type: TableType;
  zone: string;
  server_section: string;
  is_active: boolean;
}

const emptyTable: EditingTable = {
  name: '',
  min_covers: 1,
  max_covers: 2,
  shape: 'rectangle',
  table_type: 'Regular',
  zone: '',
  server_section: '',
  is_active: true,
};

function sortTablesByOrder(a: VenueTable, b: VenueTable): number {
  const o = a.sort_order - b.sort_order;
  if (o !== 0) return o;
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}

function GripVerticalIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 6a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm0 7.5a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm0 7.5a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm8-15a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm0 7.5a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm0 7.5a1.5 1.5 0 110-3 1.5 1.5 0 010 3z" />
    </svg>
  );
}

function SortableTableRow({
  id,
  label,
  canReorder,
  className,
  children,
  reordering,
}: {
  id: string;
  label: string;
  canReorder: boolean;
  className?: string;
  children: (dragHandle: ReactNode) => ReactNode;
  reordering?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !canReorder || Boolean(reordering),
  });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.92 : undefined,
    zIndex: isDragging ? 2 : undefined,
    position: isDragging ? 'relative' : undefined,
  };
  const dragHandle = canReorder ? (
    <button
      type="button"
      className="mt-0.5 inline-flex h-8 w-8 shrink-0 cursor-grab touch-manipulation items-center justify-center rounded-md border border-slate-200/90 bg-white text-slate-500 shadow-sm hover:bg-slate-50 hover:text-slate-700 active:cursor-grabbing"
      aria-label={`Reorder ${label} on table grid`}
      {...attributes}
      {...listeners}
    >
      <GripVerticalIcon className="h-4 w-4" />
    </button>
  ) : null;

  return (
    <tr ref={setNodeRef} style={style} className={className}>
      {children(dragHandle)}
    </tr>
  );
}

export function TableList({ tables, setTables, isAdmin, onRefresh, variant = 'full', diningAreaId }: Props) {
  const isCovers = variant === 'covers';
  const tablesSorted = useMemo(() => [...tables].sort(sortTablesByOrder), [tables]);
  const [orderedIds, setOrderedIds] = useState<string[]>(() => tablesSorted.map((t) => t.id));
  const [reorderSaving, setReorderSaving] = useState(false);
  const [reorderError, setReorderError] = useState<string | null>(null);

  useEffect(() => {
    setOrderedIds([...tables].sort(sortTablesByOrder).map((t) => t.id));
  }, [tables]);

  const orderedTables = useMemo(() => {
    const byId = new Map(tables.map((t) => [t.id, t]));
    return orderedIds.map((id) => byId.get(id)).filter((t): t is VenueTable => Boolean(t));
  }, [tables, orderedIds]);

  const canReorderTables = isAdmin && tables.length > 1;

  const reorderSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );
  const totalSeatingAcrossTables = useMemo(() => {
    if (tables.length === 0) return null;
    return tables.reduce((sum, t) => sum + t.max_covers, 0);
  }, [tables]);
  const [editing, setEditing] = useState<EditingTable | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Mutually exclusive with a non-null `editing` state for add/edit flows (only one add panel at a time). */
  const [showBatch, setShowBatch] = useState(false);
  const [batchCount, setBatchCount] = useState(10);
  const [batchPrefix, setBatchPrefix] = useState('Table');
  const [batchMaxCovers, setBatchMaxCovers] = useState(4);
  const [batchShape, setBatchShape] = useState<TableShape>('rectangle');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deleteDialogIds, setDeleteDialogIds] = useState<string[] | null>(null);
  const [deleting, setDeleting] = useState(false);

  const zones = [...new Set(tables.map((t) => t.zone).filter(Boolean))] as string[];
  const showZoneColumn = !isCovers && zones.length > 0;
  const selectedTables = useMemo(
    () => tables.filter((table) => selectedIds.includes(table.id)),
    [selectedIds, tables],
  );
  const deleteDialogTables = useMemo(
    () => tables.filter((table) => deleteDialogIds?.includes(table.id)),
    [deleteDialogIds, tables],
  );
  const allVisibleSelected =
    orderedTables.length > 0 && orderedTables.every((table) => selectedIds.includes(table.id));

  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => tables.some((table) => table.id === id)));
  }, [tables]);

  const toggleSelected = useCallback((id: string, checked: boolean) => {
    setSelectedIds((current) => {
      if (checked) return current.includes(id) ? current : [...current, id];
      return current.filter((selectedId) => selectedId !== id);
    });
  }, []);

  const toggleAllVisible = useCallback((checked: boolean) => {
    const visibleIds = orderedTables.map((table) => table.id);
    setSelectedIds((current) => {
      if (checked) return Array.from(new Set([...current, ...visibleIds]));
      return current.filter((id) => !visibleIds.includes(id));
    });
  }, [orderedTables]);

  const persistTableOrder = useCallback(
    async (nextIds: string[], previousIds: string[]) => {
      const sorted = [...tables].sort(sortTablesByOrder);
      const byId = new Map(sorted.map((t) => [t.id, t]));
      const nextRows = nextIds
        .map((id, i) => {
          const t = byId.get(id);
          return t ? { ...t, sort_order: i } : null;
        })
        .filter((x): x is VenueTable => x !== null);
      if (nextRows.length !== nextIds.length) {
        setOrderedIds(previousIds);
        setReorderError('Could not update table order');
        return;
      }

      setReorderSaving(true);
      setReorderError(null);
      try {
        const res = await fetch('/api/venue/tables', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(nextRows.map((t) => ({ id: t.id, sort_order: t.sort_order }))),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setReorderError((data as { error?: string }).error ?? 'Failed to update table order');
          setOrderedIds(previousIds);
          return;
        }
        const json = (await res.json()) as { tables?: VenueTable[] };
        const returned = json.tables;
        if (returned && returned.length > 0) {
          const map = new Map(returned.map((t) => [t.id, t]));
          setTables(tables.map((t) => map.get(t.id) ?? t));
        } else {
          setTables(tables.map((t) => nextRows.find((n) => n.id === t.id) ?? t));
        }
      } catch (err) {
        console.error('Reorder tables error:', err);
        setReorderError('Failed to update table order');
        setOrderedIds(previousIds);
      } finally {
        setReorderSaving(false);
      }
    },
    [tables, setTables],
  );

  const onReorderDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (!canReorderTables) return;
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = orderedIds.indexOf(active.id as string);
      const newIndex = orderedIds.indexOf(over.id as string);
      if (oldIndex < 0 || newIndex < 0) return;
      const previousIds = orderedIds;
      const nextIds = arrayMove(orderedIds, oldIndex, newIndex);
      setOrderedIds(nextIds);
      void persistTableOrder(nextIds, previousIds);
    },
    [canReorderTables, orderedIds, persistTableOrder],
  );

  const saveTable = async () => {
    if (!editing) return;
    setSaving(true);
    setError(null);

    try {
      if (editing.id) {
        const res = await fetch('/api/venue/tables', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: editing.id,
            name: editing.name,
            min_covers: editing.min_covers,
            max_covers: editing.max_covers,
            shape: editing.shape,
            table_type: editing.table_type,
            zone: editing.zone || null,
            server_section: editing.server_section || null,
            is_active: editing.is_active,
          }),
        });
        if (!res.ok) {
          const data = await res.json();
          setError(data.error ?? 'Failed to update table');
          return;
        }
        const { table } = await res.json();
        setTables(tables.map((t) => (t.id === table.id ? table : t)));
      } else {
        const dims = getTableDimensions(editing.max_covers, editing.shape);
        const res = await fetch('/api/venue/tables', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: editing.name,
            min_covers: editing.min_covers,
            max_covers: editing.max_covers,
            shape: editing.shape,
            table_type: editing.table_type,
            zone: editing.zone || null,
            server_section: editing.server_section || null,
            is_active: editing.is_active,
            sort_order: tables.length,
            width: dims.width,
            height: dims.height,
            ...(diningAreaId ? { area_id: diningAreaId } : {}),
          }),
        });
        if (!res.ok) {
          const data = await res.json();
          setError(data.error ?? 'Failed to create table');
          return;
        }
        onRefresh();
      }
      setEditing(null);
    } catch (err) {
      console.error('Save table error:', err);
      setError('Failed to save table');
    } finally {
      setSaving(false);
    }
  };

  const requestDeleteTables = (ids: string[]) => {
    if (ids.length === 0) return;
    setDeleteDialogIds(ids);
  };

  const deleteTables = async (ids: string[]) => {
    if (ids.length === 0) return;
    setDeleting(true);
    setError(null);
    try {
      const results = await Promise.all(
        ids.map(async (id) => {
          try {
            const res = await fetch(`/api/venue/tables?id=${id}`, { method: 'DELETE' });
            const payload = !res.ok ? await res.json().catch(() => ({})) : null;
            return {
              id,
              ok: res.ok,
              error: (payload as { error?: string } | null)?.error ?? null,
            };
          } catch {
            return { id, ok: false, error: 'Network error deleting table' };
          }
        }),
      );
      const okIds = new Set(results.filter((result) => result.ok).map((result) => result.id));
      if (okIds.size > 0) {
        setTables(tables.filter((table) => !okIds.has(table.id)));
        setSelectedIds((current) => current.filter((id) => !okIds.has(id)));
      }
      const failed = results.filter((result) => !result.ok);
      if (failed.length > 0) {
        const firstError = failed.find((result) => result.error)?.error;
        setError(
          firstError ??
            `Failed to delete ${failed.length === 1 ? '1 table' : `${failed.length} tables`}.`,
        );
      }
    } catch (err) {
      console.error('Delete tables error:', err);
      setError('Failed to delete tables');
    } finally {
      setDeleting(false);
      setDeleteDialogIds(null);
    }
  };

  const openEditTable = useCallback((row: EditingTable) => {
    setShowBatch(false);
    setError(null);
    setEditing(row);
  }, []);

  const duplicateTable = useCallback((table: VenueTable) => {
    setShowBatch(false);
    setError(null);
    setEditing({
      name: `${table.name} (copy)`,
      min_covers: table.min_covers,
      max_covers: table.max_covers,
      shape: table.shape as TableShape,
      table_type: (table.table_type as TableType) ?? 'Regular',
      zone: table.zone ?? '',
      server_section: table.server_section ?? '',
      is_active: table.is_active,
    });
  }, []);

  const createBatch = async () => {
    setSaving(true);
    setError(null);

    const batchSpecs = Array.from({ length: batchCount }, () => {
      const shape = batchShape;
      const dims = getTableDimensions(batchMaxCovers, shape);
      return {
        min_covers: 1,
        max_covers: batchMaxCovers,
        shape,
        width: dims.width,
        height: dims.height,
      };
    });
    const existingPositionSpecs = tables.map((table) => ({
      max_covers: table.max_covers,
      shape: table.shape,
      width: table.width,
      height: table.height,
    }));
    const batchPositions = computeGridPositions([...existingPositionSpecs, ...batchSpecs]).slice(tables.length);
    const newTables = batchSpecs.map((spec, i) => {
      const position = batchPositions[i];
      return {
        name: `${batchPrefix} ${tables.length + i + 1}`,
        ...spec,
        position_x: position?.position_x ?? null,
        position_y: position?.position_y ?? null,
        width: position?.width ?? spec.width,
        height: position?.height ?? spec.height,
        sort_order: tables.length + i,
      };
    });

    try {
      const res = await fetch('/api/venue/tables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tables: newTables,
          ...(diningAreaId ? { area_id: diningAreaId } : {}),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? 'Failed to create tables');
        return;
      }

      setShowBatch(false);
      setEditing(null);
      onRefresh();
    } catch (err) {
      console.error('Batch create error:', err);
      setError('Failed to create tables');
    } finally {
      setSaving(false);
    }
  };

  const openAddSingleForm = useCallback(() => {
    setShowBatch(false);
    setError(null);
    setEditing({ ...emptyTable });
  }, []);

  const openAddMultipleForm = useCallback(() => {
    setEditing(null);
    setError(null);
    setShowBatch(true);
  }, []);

  const closeAddPanels = useCallback(() => {
    setEditing(null);
    setShowBatch(false);
    setError(null);
  }, []);

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        {totalSeatingAcrossTables == null ? (
          'No tables yet.'
        ) : (
          <>
            Total seating across all tables:{' '}
            <span className="font-semibold text-slate-900">{totalSeatingAcrossTables}</span>
            {isCovers ? ' seats' : ' covers'}.
          </>
        )}
      </p>
      {isAdmin && tables.length > 1 && (
        <p className="text-xs text-slate-500">
          Table order matches the table grid. Drag a row by the handle to change the order.
        </p>
      )}
      {reorderSaving && (
        <p className="flex items-center gap-2 text-xs text-slate-500">
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-brand-600" aria-hidden />
          Saving table order…
        </p>
      )}
      {reorderError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{reorderError}</div>
      )}

      {isAdmin && (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <button
            type="button"
            onClick={openAddSingleForm}
            className="min-h-11 w-full touch-manipulation rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-brand-700 sm:w-auto"
          >
            + Add Table
          </button>
          <button
            type="button"
            onClick={openAddMultipleForm}
            className="min-h-11 w-full touch-manipulation rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 sm:w-auto"
          >
            + Add Multiple
          </button>
          {selectedTables.length > 0 && (
            <button
              type="button"
              onClick={() => requestDeleteTables(selectedTables.map((table) => table.id))}
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 shadow-sm hover:bg-red-100"
            >
              Delete selected ({selectedTables.length})
            </button>
          )}
        </div>
      )}

      {showBatch && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <h3 className="mb-3 text-base font-medium text-slate-900 sm:mb-4">Add Multiple Tables</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="min-w-0">
              <label className="block text-xs font-medium text-slate-600">Count</label>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {[5, 10, 15, 20, 25, 30].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setBatchCount(n)}
                    className={`min-h-11 min-w-[2.75rem] touch-manipulation rounded-lg border px-3 py-2 text-sm font-medium ${
                      batchCount === n
                        ? 'border-brand-300 bg-brand-50 text-brand-700'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <div className="min-w-0">
              <label className="block text-xs font-medium text-slate-600">Prefix</label>
              <input
                type="text"
                value={batchPrefix}
                onChange={(e) => setBatchPrefix(e.target.value)}
                className="mt-1.5 block min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-base sm:text-sm"
                autoComplete="off"
              />
            </div>
            <div className="min-w-0">
              <label className="block text-xs font-medium text-slate-600">Max Covers</label>
              <NumericInput
                value={batchMaxCovers}
                onChange={(v) => setBatchMaxCovers(v)}
                min={1}
                max={50}
                className="mt-1.5 block min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-base sm:text-sm"
              />
            </div>
            <div className="min-w-0">
              <label className="block text-xs font-medium text-slate-600">Shape</label>
              <select
                value={batchShape}
                onChange={(e) => setBatchShape(e.target.value as TableShape)}
                className="mt-1.5 block min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-base sm:text-sm"
              >
                {SHAPES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap">
            <button
              type="button"
              onClick={closeAddPanels}
              className="min-h-11 w-full touch-manipulation rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 sm:w-auto"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void createBatch()}
              disabled={saving}
              className="min-h-11 w-full touch-manipulation rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 sm:w-auto"
            >
              {saving ? 'Creating...' : `Create ${batchCount} Tables`}
            </button>
          </div>
        </div>
      )}

      {editing && (
        <div className="rounded-xl border border-brand-200 bg-brand-50/30 p-4 shadow-sm sm:p-5">
          <h3 className="mb-3 text-base font-medium text-slate-900 sm:mb-4">
            {editing.id ? 'Edit Table' : 'New Table'}
          </h3>
          {error && (
            <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="min-w-0">
              <label className="block text-xs font-medium text-slate-600">Name</label>
              <input
                type="text"
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                className="mt-1.5 block min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-base sm:text-sm"
                placeholder="e.g. T1, Booth A"
                autoComplete="off"
              />
            </div>
            {!isCovers && (
              <div className="min-w-0">
                <label className="block text-xs font-medium text-slate-600">Min Covers</label>
                <NumericInput
                  value={editing.min_covers}
                  onChange={(v) => setEditing({ ...editing, min_covers: v })}
                  min={1}
                  max={50}
                  className="mt-1.5 block min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-base sm:text-sm"
                />
              </div>
            )}
            <div className="min-w-0">
              <label className="block text-xs font-medium text-slate-600">{isCovers ? 'Seats' : 'Max Covers'}</label>
              <NumericInput
                value={editing.max_covers}
                onChange={(v) => setEditing({ ...editing, max_covers: v, ...(isCovers ? { min_covers: 1 } : {}) })}
                min={1}
                max={50}
                className="mt-1.5 block min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-base sm:text-sm"
              />
            </div>
            <div className="min-w-0">
              <label className="block text-xs font-medium text-slate-600">Shape</label>
              <select
                value={editing.shape}
                onChange={(e) => setEditing({ ...editing, shape: e.target.value as TableShape })}
                className="mt-1.5 block min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-base sm:text-sm"
              >
                {SHAPES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
            {!isCovers && (
              <>
                <div className="min-w-0">
                  <label className="block text-xs font-medium text-slate-600">Table Type</label>
                  <select
                    value={editing.table_type}
                    onChange={(e) => setEditing({ ...editing, table_type: e.target.value as TableType })}
                    className="mt-1.5 block min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-base sm:text-sm"
                  >
                    {TABLE_TYPES.map((tt) => (
                      <option key={tt} value={tt}>{tt}</option>
                    ))}
                  </select>
                </div>
                <div className="min-w-0">
                  <label className="block text-xs font-medium text-slate-600">Zone / Area</label>
                  <input
                    type="text"
                    value={editing.zone}
                    onChange={(e) => setEditing({ ...editing, zone: e.target.value })}
                    className="mt-1.5 block min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-base sm:text-sm"
                    placeholder="e.g. Main floor, Upper level"
                    list="zone-suggestions"
                  />
                  {zones.length > 0 && (
                    <datalist id="zone-suggestions">
                      {zones.map((z) => <option key={z} value={z} />)}
                    </datalist>
                  )}
                </div>
                <div className="min-w-0">
                  <label className="block text-xs font-medium text-slate-600">Server Section</label>
                  <input
                    type="text"
                    value={editing.server_section}
                    onChange={(e) => setEditing({ ...editing, server_section: e.target.value })}
                    className="mt-1.5 block min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-base sm:text-sm"
                    placeholder="Optional"
                  />
                </div>
              </>
            )}
          </div>
          <div className="mt-4 flex items-center gap-3">
            <label className="text-xs font-medium text-slate-600">Active</label>
            <button
              type="button"
              onClick={() => setEditing({ ...editing, is_active: !editing.is_active })}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer touch-manipulation rounded-full border-2 border-transparent transition-colors ${
                editing.is_active ? 'bg-brand-600' : 'bg-slate-200'
              }`}
              aria-pressed={editing.is_active}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${
                editing.is_active ? 'translate-x-4' : 'translate-x-0'
              }`} />
            </button>
          </div>
          <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap">
            <button
              type="button"
              onClick={closeAddPanels}
              className="min-h-11 w-full touch-manipulation rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 sm:w-auto"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void saveTable()}
              disabled={saving || !editing.name.trim()}
              className="min-h-11 w-full touch-manipulation rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 sm:w-auto"
            >
              {saving ? 'Saving...' : editing.id ? 'Save Changes' : 'Add Table'}
            </button>
          </div>
        </div>
      )}

      {tables.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 px-6 py-8 text-center">
          <p className="text-sm text-slate-500">No tables configured yet. Add your first table above.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <HorizontalScrollHint />
          <div className="touch-pan-x overflow-x-auto [-webkit-overflow-scrolling:touch]">
            {canReorderTables ? (
              <DndContext sensors={reorderSensors} collisionDetection={closestCenter} onDragEnd={onReorderDragEnd}>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/50">
                      {isAdmin && (
                        <th className="w-[1%] whitespace-nowrap px-3 py-2.5 text-center">
                          <input
                            type="checkbox"
                            checked={allVisibleSelected}
                            onChange={(event) => toggleAllVisible(event.target.checked)}
                            aria-label="Select all visible tables"
                          />
                        </th>
                      )}
                      <th className="w-[1%] whitespace-nowrap px-2 py-2.5 text-center text-xs font-medium text-slate-500">
                        Order
                      </th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">Name</th>
                      {showZoneColumn && (
                        <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">Zone</th>
                      )}
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">Shape</th>
                      <th className="px-4 py-2.5 text-center text-xs font-medium text-slate-500">{isCovers ? 'Seats' : 'Covers'}</th>
                      {!isCovers && <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">Type</th>}
                      <th className="px-4 py-2.5 text-center text-xs font-medium text-slate-500">Active</th>
                      {isAdmin && (
                        <th className="px-4 py-2.5 text-right text-xs font-medium text-slate-500">Actions</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    <SortableContext items={orderedIds} strategy={verticalListSortingStrategy}>
                      {orderedTables.map((t) => (
                        <SortableTableRow
                          key={t.id}
                          id={t.id}
                          label={t.name}
                          canReorder
                          reordering={reorderSaving}
                          className={`hover:bg-slate-50/50 ${!t.is_active ? 'opacity-50' : ''}`}
                        >
                          {(dragHandle) => (
                            <>
                              {isAdmin && (
                                <td className="w-[1%] px-3 py-2.5 text-center align-top">
                                  <input
                                    type="checkbox"
                                    checked={selectedIds.includes(t.id)}
                                    onChange={(event) => toggleSelected(t.id, event.target.checked)}
                                    aria-label={`Select ${t.name}`}
                                  />
                                </td>
                              )}
                              <td className="w-[1%] px-2 py-2.5 align-top">{dragHandle}</td>
                              <td className="px-4 py-2.5 font-medium text-slate-900">{t.name}</td>
                              {showZoneColumn && (
                                <td className="px-4 py-2.5 text-slate-600">{t.zone ?? '—'}</td>
                              )}
                              <td className="px-4 py-2.5 capitalize text-slate-600">{t.shape}</td>
                              <td className="px-4 py-2.5 text-center text-slate-600">
                                {isCovers ? t.max_covers : `${t.min_covers}–${t.max_covers}`}
                              </td>
                              {!isCovers && <td className="px-4 py-2.5 text-slate-600">{t.table_type ?? 'Regular'}</td>}
                              <td className="px-4 py-2.5 text-center">
                                <span className={`inline-block h-2 w-2 rounded-full ${t.is_active ? 'bg-green-500' : 'bg-slate-300'}`} />
                              </td>
                              {isAdmin && (
                                <td className="px-4 py-2.5 text-right">
                                  <div className="flex items-center justify-end gap-1">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        openEditTable({
                                          id: t.id,
                                          name: t.name,
                                          min_covers: t.min_covers,
                                          max_covers: t.max_covers,
                                          shape: t.shape as TableShape,
                                          table_type: (t.table_type as TableType) ?? 'Regular',
                                          zone: t.zone ?? '',
                                          server_section: t.server_section ?? '',
                                          is_active: t.is_active,
                                        })
                                      }
                                      className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                                      title="Edit"
                                    >
                                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                                      </svg>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => duplicateTable(t)}
                                      className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                                      title="Duplicate"
                                    >
                                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75" />
                                      </svg>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => requestDeleteTables([t.id])}
                                      className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"
                                      title="Delete"
                                    >
                                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                                      </svg>
                                    </button>
                                  </div>
                                </td>
                              )}
                            </>
                          )}
                        </SortableTableRow>
                      ))}
                    </SortableContext>
                  </tbody>
                </table>
              </DndContext>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/50">
                    {isAdmin && (
                      <th className="w-[1%] whitespace-nowrap px-3 py-2.5 text-center">
                        <input
                          type="checkbox"
                          checked={allVisibleSelected}
                          onChange={(event) => toggleAllVisible(event.target.checked)}
                          aria-label="Select all visible tables"
                        />
                      </th>
                    )}
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">Name</th>
                    {showZoneColumn && (
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">Zone</th>
                    )}
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">Shape</th>
                    <th className="px-4 py-2.5 text-center text-xs font-medium text-slate-500">{isCovers ? 'Seats' : 'Covers'}</th>
                    {!isCovers && <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">Type</th>}
                    <th className="px-4 py-2.5 text-center text-xs font-medium text-slate-500">Active</th>
                    {isAdmin && (
                      <th className="px-4 py-2.5 text-right text-xs font-medium text-slate-500">Actions</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {orderedTables.map((t) => (
                    <tr key={t.id} className={`hover:bg-slate-50/50 ${!t.is_active ? 'opacity-50' : ''}`}>
                      {isAdmin && (
                        <td className="w-[1%] px-3 py-2.5 text-center">
                          <input
                            type="checkbox"
                            checked={selectedIds.includes(t.id)}
                            onChange={(event) => toggleSelected(t.id, event.target.checked)}
                            aria-label={`Select ${t.name}`}
                          />
                        </td>
                      )}
                      <td className="px-4 py-2.5 font-medium text-slate-900">{t.name}</td>
                      {showZoneColumn && (
                        <td className="px-4 py-2.5 text-slate-600">{t.zone ?? '—'}</td>
                      )}
                      <td className="px-4 py-2.5 capitalize text-slate-600">{t.shape}</td>
                      <td className="px-4 py-2.5 text-center text-slate-600">
                        {isCovers ? t.max_covers : `${t.min_covers}–${t.max_covers}`}
                      </td>
                      {!isCovers && <td className="px-4 py-2.5 text-slate-600">{t.table_type ?? 'Regular'}</td>}
                      <td className="px-4 py-2.5 text-center">
                        <span className={`inline-block h-2 w-2 rounded-full ${t.is_active ? 'bg-green-500' : 'bg-slate-300'}`} />
                      </td>
                      {isAdmin && (
                        <td className="px-4 py-2.5 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() =>
                                openEditTable({
                                  id: t.id,
                                  name: t.name,
                                  min_covers: t.min_covers,
                                  max_covers: t.max_covers,
                                  shape: t.shape as TableShape,
                                  table_type: (t.table_type as TableType) ?? 'Regular',
                                  zone: t.zone ?? '',
                                  server_section: t.server_section ?? '',
                                  is_active: t.is_active,
                                })
                              }
                              className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                              title="Edit"
                            >
                              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                              </svg>
                            </button>
                            <button
                              type="button"
                              onClick={() => duplicateTable(t)}
                              className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                              title="Duplicate"
                            >
                              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75" />
                              </svg>
                            </button>
                            <button
                              type="button"
                              onClick={() => requestDeleteTables([t.id])}
                              className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"
                              title="Delete"
                            >
                              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                              </svg>
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
      {deleteDialogIds && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4 py-6 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-tables-title"
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl shadow-slate-900/20"
          >
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600 ring-1 ring-red-100">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2.25 2.25 0 0 0 1.93 3.36h16.5A2.25 2.25 0 0 0 22.18 18L13.71 3.86a2.25 2.25 0 0 0-3.42 0Z" />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <h3 id="delete-tables-title" className="text-base font-semibold text-slate-950">
                  {deleteDialogIds.length === 1 ? 'Delete table?' : `Delete ${deleteDialogIds.length} tables?`}
                </h3>
                <p className="mt-1 text-sm text-slate-600">
                  This cannot be undone. Tables with future assigned bookings will not be deleted until those bookings are reassigned.
                </p>
              </div>
            </div>
            <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">
                Selected tables
              </p>
              <div className="mt-2 flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
                {deleteDialogTables.map((table) => (
                  <span
                    key={table.id}
                    className="rounded-full bg-white px-2 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-200"
                  >
                    {table.name}
                  </span>
                ))}
              </div>
            </div>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setDeleteDialogIds(null)}
                disabled={deleting}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Keep tables
              </button>
              <button
                type="button"
                onClick={() => void deleteTables(deleteDialogIds)}
                disabled={deleting}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-700 disabled:opacity-50"
              >
                {deleting
                  ? 'Deleting...'
                  : deleteDialogIds.length === 1
                    ? 'Delete table'
                    : `Delete ${deleteDialogIds.length} tables`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
