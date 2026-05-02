'use client';

import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import type { VenueArea } from '@/types/areas';
import { ClampedFixedDropdown } from '@/components/ui/ClampedFixedDropdown';

interface DiningAreaPickerProps {
  areas: VenueArea[];
  value: string;
  onChange: (id: string) => void;
  verticalAnchorRef?: RefObject<HTMLElement | null>;
  compact?: boolean;
}

export function DiningAreaPicker({
  areas,
  value,
  onChange,
  verticalAnchorRef,
  compact = false,
}: DiningAreaPickerProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const activeAreas = areas.filter((area) => area.is_active);
  const selected = activeAreas.find((area) => area.id === value);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (wrapRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  if (activeAreas.length <= 1 || !selected) return null;

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={`inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-lg border px-2 text-[11px] font-semibold shadow-sm transition-colors ${
          open
            ? 'border-brand-300 bg-brand-50 text-brand-800 ring-1 ring-brand-200'
            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900'
        } ${compact ? 'max-w-[8.75rem]' : 'max-w-[10rem]'}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label="Dining area"
        title={`Dining area: ${selected.name}`}
      >
        <span className="min-w-0 truncate">{selected.name}</span>
        <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      <ClampedFixedDropdown
        open={open}
        triggerRef={triggerRef}
        verticalAnchorRef={verticalAnchorRef}
        horizontalCenter
        gapPx={4}
        align="start"
        maxWidthPx={280}
        id={panelId}
        onDismiss={() => setOpen(false)}
        aria-label="Choose dining area"
        className="animate-fade-in z-50 w-[min(calc(100vw-1rem),17.5rem)] rounded-xl border border-slate-200 bg-white p-2 text-left shadow-xl shadow-slate-900/10 ring-1 ring-slate-100"
      >
        <div className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          Dining area
        </div>
        <div className="space-y-1">
          {activeAreas.map((area) => {
            const selectedArea = area.id === value;
            return (
              <button
                key={area.id}
                type="button"
                onClick={() => {
                  onChange(area.id);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-semibold ${
                  selectedArea
                    ? 'bg-brand-50 text-brand-800 ring-1 ring-inset ring-brand-200'
                    : 'text-slate-700 hover:bg-slate-50'
                }`}
                aria-pressed={selectedArea}
              >
                <span className="min-w-0 truncate">{area.name}</span>
                {selectedArea ? (
                  <svg className="h-4 w-4 shrink-0 text-brand-700" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                  </svg>
                ) : null}
              </button>
            );
          })}
        </div>
      </ClampedFixedDropdown>
    </div>
  );
}
