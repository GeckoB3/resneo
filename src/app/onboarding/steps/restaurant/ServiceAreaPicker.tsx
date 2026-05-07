import type { VenueArea } from '@/types/areas';

interface Props {
  activeAreas: VenueArea[];
  selectedAreaId: string | null;
  onSelectArea: (id: string) => void;
}

export function ServiceAreaPicker({ activeAreas, selectedAreaId, onSelectArea }: Props) {
  if (activeAreas.length <= 1 || !selectedAreaId) return null;

  return (
    <div className="mb-6 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="mb-2 text-sm font-medium text-slate-600">Dining area</div>
      <div className="flex flex-wrap gap-2">
        {activeAreas.map((area) => (
          <button
            key={area.id}
            type="button"
            onClick={() => onSelectArea(area.id)}
            className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors ${
              selectedAreaId === area.id
                ? 'border-brand-600 bg-brand-50 text-brand-900'
                : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100/80'
            }`}
          >
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: area.colour || '#6366F1' }}
            />
            {area.name}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Services and their capacity, duration, and booking rules are configured per dining area.
      </p>
    </div>
  );
}
