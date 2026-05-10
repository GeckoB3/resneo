'use client';

import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import type { VenueServiceRow } from '@/app/dashboard/availability/service-settings-types';
import { ClampedFixedDropdown } from '@/components/ui/ClampedFixedDropdown';
import { periodToCalendarGridHours } from '@/lib/venue-calendar-bounds';

interface FloorPlanServicePickerProps {
  /** Options for the current calendar day (parent applies weekday / opening-hours logic). */
  services: VenueServiceRow[];
  verticalAnchorRef?: RefObject<HTMLElement | null>;
  compact?: boolean;
  selectedServiceId: string | null;
  onSelectService: (service: VenueServiceRow) => void;
}

export function FloorPlanServicePicker({
  services,
  verticalAnchorRef,
  compact = false,
  selectedServiceId,
  onSelectService,
}: FloorPlanServicePickerProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

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

  const selected = selectedServiceId ? services.find((s) => s.id === selectedServiceId) : undefined;

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
        } ${compact ? 'max-w-[9.5rem]' : 'max-w-[11rem]'}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label="Service"
        title={selected ? `Service: ${selected.name}` : 'Choose service — sets timeline to service hours'}
      >
        <span className="min-w-0 truncate">{selected?.name ?? 'Service'}</span>
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
        aria-label="Choose service"
        className="animate-fade-in z-50 w-[min(calc(100vw-1rem),17.5rem)] rounded-xl border border-slate-200 bg-white p-2 text-left shadow-xl shadow-slate-900/10 ring-1 ring-slate-100"
      >
        <div className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          Service
        </div>
        {services.length === 0 ? (
          <p className="px-2.5 py-3 text-xs leading-snug text-slate-600">
            No services or trading periods for this day. Add services under Availability, or set business hours in
            Settings.
          </p>
        ) : (
          <div className="space-y-1">
            {services.map((service) => {
              const bounds = periodToCalendarGridHours(service.start_time, service.end_time);
              const rangeLabel = bounds
                ? `${String(bounds.startHour).padStart(2, '0')}:00–${String(bounds.endHour).padStart(2, '0')}:00`
                : '';
              const isSelected = service.id === selectedServiceId;
              return (
                <button
                  key={service.id}
                  type="button"
                  onClick={() => {
                    onSelectService(service);
                    setOpen(false);
                  }}
                  className={`flex w-full flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left ${
                    isSelected
                      ? 'bg-brand-50 text-brand-900 ring-1 ring-inset ring-brand-200'
                      : 'text-slate-700 hover:bg-slate-50'
                  }`}
                  aria-pressed={isSelected}
                >
                  <span className="text-sm font-semibold leading-tight">{service.name}</span>
                  <span className="text-[11px] font-medium tabular-nums text-slate-500">
                    {service.start_time.slice(0, 5)} start
                    {rangeLabel ? ` · ${rangeLabel}` : ''}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </ClampedFixedDropdown>
    </div>
  );
}
