'use client';

import type { MouseEvent } from 'react';

export interface DashboardEntityRowActionsProps {
  onEdit: () => void;
  onDelete: () => void;
  showDelete?: boolean;
  /** "View" where the row can be opened but not changed (a service another venue manages). */
  editLabel?: string;
  /** Use inside clickable parents (e.g. selectable cards). */
  stopPropagation?: boolean;
  className?: string;
}

/** Edit / Delete controls — shared styling; inline row for list/detail headers (classes, services, resources, events). */
export function DashboardEntityRowActions({
  onEdit,
  onDelete,
  showDelete = true,
  editLabel = 'Edit',
  stopPropagation = false,
  className = '',
}: DashboardEntityRowActionsProps) {
  const wrap =
    (fn: () => void) =>
    (e: MouseEvent) => {
      if (stopPropagation) e.stopPropagation();
      fn();
    };

  return (
    <div className={`flex shrink-0 flex-row flex-wrap items-center gap-1 ${className}`.trim()}>
      <button
        type="button"
        onClick={wrap(onEdit)}
        className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium leading-4 text-slate-700 hover:bg-slate-50"
      >
        {editLabel}
      </button>
      {showDelete ? (
        <button
          type="button"
          onClick={wrap(onDelete)}
          className="rounded-md border border-transparent px-2 py-1 text-xs font-medium leading-4 text-red-600 hover:bg-red-50"
        >
          Delete
        </button>
      ) : null}
    </div>
  );
}
