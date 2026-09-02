'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@/components/ui/primitives/Button';
import { ConfirmDialog } from '@/components/ui/primitives/ConfirmDialog';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import { EmptyState } from '@/components/ui/dashboard/EmptyState';
import type { ServiceCategoryRef } from '@/lib/booking/service-categories';

/**
 * The Categories tab of the Services page: create, rename, delete and reorder
 * the headings the booking pages group services under. Admin-only writes; other
 * staff see the list read-only. Order changes save optimistically and roll back
 * on failure, the same contract as service reordering.
 */

/**
 * Where the four writes go. The default talks to the venue endpoints; the combined
 * page manager supplies one that goes through its catalogue actions instead, so
 * both surfaces share this component unchanged.
 */
export interface ServiceCategoryApi {
  create: (name: string) => Promise<ServiceCategoryRef>;
  rename: (id: string, name: string) => Promise<ServiceCategoryRef>;
  remove: (id: string) => Promise<void>;
  reorder: (ids: string[]) => Promise<void>;
}

export const venueServiceCategoryApi: ServiceCategoryApi = {
  create: async (name) => {
    const res = await fetch('/api/venue/service-categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error(await readError(res, 'Failed to create the category'));
    return ((await res.json()) as { category: ServiceCategoryRef }).category;
  },
  rename: async (id, name) => {
    const res = await fetch('/api/venue/service-categories', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name }),
    });
    if (!res.ok) throw new Error(await readError(res, 'Failed to rename the category'));
    return ((await res.json()) as { category: ServiceCategoryRef }).category;
  },
  remove: async (id) => {
    const res = await fetch('/api/venue/service-categories', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    if (!res.ok) throw new Error(await readError(res, 'Failed to delete the category'));
  },
  reorder: async (ids) => {
    const res = await fetch('/api/venue/service-categories/reorder', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category_ids: ids }),
    });
    if (!res.ok) throw new Error(await readError(res, 'Failed to save the new order'));
  },
};

const DEFAULT_SETTINGS_HINT =
  'Choose whether the booking page shows categories as sections with a menu, or as collapsible headings, under Settings, then Booking Page.';
const DEFAULT_UNCATEGORISED_HINT = 'Set a category on each service from the Services tab.';

export interface ServiceCategoriesManagerProps {
  categories: ServiceCategoryRef[];
  /** Defaults to the venue endpoints. */
  api?: ServiceCategoryApi;
  /** Where the layout choice lives; null hides the note. */
  settingsHint?: string | null;
  /** How to file the uncategorised services; shown after their count. */
  uncategorisedHint?: string;
  /** Services per category id, for the count on each row and the delete warning. */
  serviceCountByCategory: ReadonlyMap<string, number>;
  /** Services with no category, shown as a hint under the list. */
  uncategorisedCount: number;
  isAdmin: boolean;
  /** The list after any successful change, so the parent can keep its copy in step. */
  onChange: (next: ServiceCategoryRef[]) => void;
}

const CATEGORY_NAME_MAX = 80;

async function readError(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: unknown };
  return typeof body.error === 'string' && body.error.trim() ? body.error : fallback;
}

function GripVerticalIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 6a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm0 7.5a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm0 7.5a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm8-15a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm0 7.5a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm0 7.5a1.5 1.5 0 110-3 1.5 1.5 0 010 3z" />
    </svg>
  );
}

function pluralServices(n: number): string {
  return `${n} service${n === 1 ? '' : 's'}`;
}

function SortableCategoryRow({
  id,
  label,
  canReorder,
  children,
}: {
  id: string;
  label: string;
  canReorder: boolean;
  children: (dragHandle: ReactNode) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !canReorder,
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
      className="inline-flex h-8 w-8 shrink-0 cursor-grab touch-none select-none items-center justify-center rounded-md border border-slate-200/90 bg-white text-slate-500 shadow-sm hover:bg-slate-50 hover:text-slate-700 active:cursor-grabbing"
      aria-label={`Reorder ${label}`}
      {...attributes}
      {...listeners}
    >
      <GripVerticalIcon className="h-4 w-4" />
    </button>
  ) : null;
  return (
    <li ref={setNodeRef} style={style} className="list-none">
      {children(dragHandle)}
    </li>
  );
}

export function ServiceCategoriesManager({
  categories,
  serviceCountByCategory,
  uncategorisedCount,
  isAdmin,
  onChange,
  api = venueServiceCategoryApi,
  settingsHint = DEFAULT_SETTINGS_HINT,
  uncategorisedHint = DEFAULT_UNCATEGORISED_HINT,
}: ServiceCategoriesManagerProps) {
  // Local copy so a drag shows instantly; the parent's list follows on success.
  const [items, setItems] = useState<ServiceCategoryRef[]>(categories);
  useEffect(() => {
    setItems(categories);
  }, [categories]);

  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ServiceCategoryRef | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [reorderSaving, setReorderSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canReorder = isAdmin && items.length > 1 && !reorderSaving;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    // Tab to a handle, Space to lift, arrows to move: the list must be reorderable
    // without a pointer.
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const itemIds = useMemo(() => items.map((c) => c.id), [items]);

  const persistOrder = useCallback(
    async (next: ServiceCategoryRef[], previous: ServiceCategoryRef[]) => {
      setReorderSaving(true);
      setError(null);
      try {
        await api.reorder(next.map((c) => c.id));
        const renumbered = next.map((c, idx) => ({ ...c, sort_order: idx }));
        setItems(renumbered);
        onChange(renumbered);
      } catch (err) {
        setItems(previous);
        setError(err instanceof Error ? err.message : 'Failed to save the new order');
      } finally {
        setReorderSaving(false);
      }
    },
    [onChange, api],
  );

  const moveTo = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (!canReorder) return;
      if (fromIndex < 0 || toIndex < 0 || toIndex >= items.length || fromIndex === toIndex) return;
      const previous = items;
      const next = arrayMove(items, fromIndex, toIndex);
      setItems(next);
      void persistOrder(next, previous);
    },
    [canReorder, items, persistOrder],
  );

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      moveTo(itemIds.indexOf(active.id as string), itemIds.indexOf(over.id as string));
    },
    [itemIds, moveTo],
  );

  async function addCategory() {
    const name = newName.trim().replace(/\s+/g, ' ');
    if (!name || adding) return;
    setAdding(true);
    setError(null);
    try {
      const category = await api.create(name);
      const next = [...items, category];
      setItems(next);
      onChange(next);
      setNewName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create the category');
    } finally {
      setAdding(false);
    }
  }

  function startRename(category: ServiceCategoryRef) {
    setEditingId(category.id);
    setEditingName(category.name);
    setError(null);
  }

  function cancelRename() {
    setEditingId(null);
    setEditingName('');
  }

  async function commitRename() {
    if (!editingId || renaming) return;
    const current = items.find((c) => c.id === editingId);
    const name = editingName.trim().replace(/\s+/g, ' ');
    if (!current) return cancelRename();
    if (!name || name === current.name) return cancelRename();
    setRenaming(true);
    setError(null);
    try {
      const category = await api.rename(editingId, name);
      const next = items.map((c) => (c.id === category.id ? { ...c, name: category.name } : c));
      setItems(next);
      onChange(next);
      cancelRename();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rename the category');
    } finally {
      setRenaming(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      await api.remove(deleteTarget.id);
      const next = items.filter((c) => c.id !== deleteTarget.id);
      setItems(next);
      onChange(next);
      setDeleteTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete the category');
    } finally {
      setDeleting(false);
    }
  }

  const deleteCount = deleteTarget ? serviceCountByCategory.get(deleteTarget.id) ?? 0 : 0;

  return (
    <div className="space-y-4">
      <SectionCard>
        <SectionCard.Header
          title="Categories"
          description="Group your services under headings on your booking page, so customers find what they want faster. Drag the handle (or use the arrows) to set the order they appear in."
        />
        <SectionCard.Body>
          {isAdmin ? (
            <form
              className="flex flex-col gap-2 sm:flex-row sm:items-center"
              onSubmit={(e) => {
                e.preventDefault();
                void addCategory();
              }}
            >
              <label htmlFor="new-service-category" className="sr-only">
                New category name
              </label>
              <input
                id="new-service-category"
                type="text"
                value={newName}
                maxLength={CATEGORY_NAME_MAX}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Hair, Nails, Massage"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 sm:max-w-sm"
                disabled={adding}
              />
              <Button type="submit" variant="primary" disabled={adding || !newName.trim()} loading={adding}>
                Add category
              </Button>
            </form>
          ) : null}

          {error ? (
            <div role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          {items.length === 0 ? (
            <div className="mt-4">
              <EmptyState
                size="compact"
                title="No categories yet"
                description={
                  isAdmin
                    ? 'Add your first category above, then choose a category on each service.'
                    : 'Your venue admin has not created any categories yet.'
                }
              />
            </div>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
                <ul className="mt-4 space-y-2 p-0">
                  {items.map((category, index) => {
                    const count = serviceCountByCategory.get(category.id) ?? 0;
                    const isEditing = editingId === category.id;
                    return (
                      <SortableCategoryRow
                        key={category.id}
                        id={category.id}
                        label={category.name}
                        canReorder={canReorder}
                      >
                        {(dragHandle) => (
                          <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
                            {isAdmin ? (
                              <span className="flex items-center gap-1">
                                {dragHandle}
                                <button
                                  type="button"
                                  onClick={() => moveTo(index, index - 1)}
                                  disabled={!canReorder || index === 0}
                                  aria-label={`Move ${category.name} up`}
                                  className="inline-flex h-8 w-6 items-center justify-center rounded-md border border-slate-200/90 bg-white text-slate-500 shadow-sm hover:bg-slate-50 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                    <path d="M5 15l7-7 7 7" strokeLinecap="round" strokeLinejoin="round" />
                                  </svg>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => moveTo(index, index + 1)}
                                  disabled={!canReorder || index === items.length - 1}
                                  aria-label={`Move ${category.name} down`}
                                  className="inline-flex h-8 w-6 items-center justify-center rounded-md border border-slate-200/90 bg-white text-slate-500 shadow-sm hover:bg-slate-50 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                    <path d="M19 9l-7 7-7-7" strokeLinecap="round" strokeLinejoin="round" />
                                  </svg>
                                </button>
                              </span>
                            ) : null}

                            <div className="min-w-0 flex-1">
                              {isEditing ? (
                                <form
                                  className="flex items-center gap-2"
                                  onSubmit={(e) => {
                                    e.preventDefault();
                                    void commitRename();
                                  }}
                                >
                                  <label htmlFor={`rename-category-${category.id}`} className="sr-only">
                                    Category name
                                  </label>
                                  <input
                                    id={`rename-category-${category.id}`}
                                    type="text"
                                    autoFocus
                                    value={editingName}
                                    maxLength={CATEGORY_NAME_MAX}
                                    onChange={(e) => setEditingName(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Escape') cancelRename();
                                    }}
                                    className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                                    disabled={renaming}
                                  />
                                  <Button type="submit" variant="primary" size="sm" loading={renaming} disabled={renaming}>
                                    Save
                                  </Button>
                                  <Button type="button" variant="secondary" size="sm" onClick={cancelRename} disabled={renaming}>
                                    Cancel
                                  </Button>
                                </form>
                              ) : (
                                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                                  <span className="truncate text-sm font-medium text-slate-900">{category.name}</span>
                                  <span className="text-xs text-slate-400">{pluralServices(count)}</span>
                                </div>
                              )}
                            </div>

                            {isAdmin && !isEditing ? (
                              <div className="flex shrink-0 items-center gap-1">
                                <Button type="button" variant="secondary" size="sm" onClick={() => startRename(category)}>
                                  Rename
                                </Button>
                                <Button type="button" variant="danger" size="sm" onClick={() => setDeleteTarget(category)}>
                                  Delete
                                </Button>
                              </div>
                            ) : null}
                          </div>
                        )}
                      </SortableCategoryRow>
                    );
                  })}
                </ul>
              </SortableContext>
            </DndContext>
          )}

          {items.length > 0 && uncategorisedCount > 0 ? (
            <p className="mt-3 text-xs text-slate-500">
              {pluralServices(uncategorisedCount)} {uncategorisedCount === 1 ? 'has' : 'have'} no category and{' '}
              {uncategorisedCount === 1 ? 'appears' : 'appear'} under &ldquo;Other services&rdquo; at the end of your booking
              page. {uncategorisedHint}
            </p>
          ) : null}
          {items.length > 0 && settingsHint ? <p className="mt-3 text-xs text-slate-500">{settingsHint}</p> : null}
        </SectionCard.Body>
      </SectionCard>

      <ConfirmDialog
        open={deleteTarget != null}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null);
        }}
        title={deleteTarget ? `Delete "${deleteTarget.name}"?` : 'Delete category?'}
        message={
          deleteCount > 0
            ? `${pluralServices(deleteCount)} will stay bookable and move to "Other services" on your booking page. Nothing about a service is deleted.`
            : 'No services use this category. Nothing else changes.'
        }
        confirmLabel={deleting ? 'Deleting…' : 'Delete category'}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
