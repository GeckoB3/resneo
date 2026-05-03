'use client';

import { useMemo } from 'react';

export interface TableForSelector {
  id: string;
  name: string;
  max_covers: number;
  sort_order: number;
  area_id?: string | null;
}

export interface TableOccupant {
  bookingId: string;
  guestName: string;
}

export type OccupancyMap = Record<string, TableOccupant | null>;

interface Props {
  tables: TableForSelector[];
  occupancyMap: OccupancyMap;
  partySize: number;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  onConfirm: (ids: string[]) => void;
  onSkip: () => void;
  confirmLabel?: string;
  skipLabel?: string;
}

export function TableSelector({
  tables,
  occupancyMap,
  partySize,
  selectedIds,
  onChange,
  onConfirm,
  onSkip,
  confirmLabel = 'Confirm',
  skipLabel = 'Seat without table',
}: Props) {
  const sorted = useMemo(
    () => [...tables].sort((a, b) => a.sort_order - b.sort_order),
    [tables],
  );

  const selectedCapacity = useMemo(
    () => sorted.filter((t) => selectedIds.includes(t.id)).reduce((sum, t) => sum + t.max_covers, 0),
    [sorted, selectedIds],
  );

  const capacityShort = selectedIds.length > 0 && selectedCapacity < partySize;

  function toggle(id: string) {
    onChange(
      selectedIds.includes(id)
        ? selectedIds.filter((x) => x !== id)
        : [...selectedIds, id],
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {sorted.map((table) => {
          const occupant = occupancyMap[table.id] ?? null;
          const isOccupied = occupant !== null;
          const isSelected = selectedIds.includes(table.id);

          return (
            <button
              key={table.id}
              type="button"
              onClick={() => toggle(table.id)}
              title={isOccupied ? `Occupied by ${occupant.guestName}` : `${table.name} (${table.max_covers} seats)`}
              className={`
                relative rounded-lg border px-3 py-2 text-xs font-medium transition-colors
                ${isSelected
                  ? 'border-brand-400 bg-brand-50 text-brand-800 ring-1 ring-brand-400'
                  : isOccupied
                    ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
                    : 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                }
              `}
            >
              <span className="font-semibold">{table.name}</span>
              <span className="ml-1.5 text-[10px] opacity-70">({table.max_covers})</span>
              {isOccupied && !isSelected && (
                <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-red-500" />
              )}
            </button>
          );
        })}
      </div>

      {capacityShort && (
        <p className="text-xs text-amber-600">
          Selected capacity ({selectedCapacity}) is less than party size ({partySize}).
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={selectedIds.length === 0}
          onClick={() => onConfirm(selectedIds)}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {confirmLabel}
        </button>
        <button
          type="button"
          onClick={onSkip}
          className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
        >
          {skipLabel}
        </button>
      </div>
    </div>
  );
}
