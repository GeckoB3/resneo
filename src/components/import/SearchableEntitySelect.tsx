'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';

export type EntityOption = { id: string; name: string };

type Props = {
  options: EntityOption[];
  value: string;
  onChange: (id: string) => void;
  /** Accessible label for the control (e.g. "Match Gel Nails to an existing service"). */
  ariaLabel: string;
  /** Placeholder shown when nothing is selected. */
  placeholder?: string;
  disabled?: boolean;
  className?: string;
};

/**
 * Accessible, filterable "map to existing" combobox. Type to filter the venue's
 * entities by name; navigate with up/down, choose with enter, dismiss with escape.
 * Built for the import References step where a venue may have hundreds of services,
 * so a plain <select> is unusable. Mobile-friendly (large touch targets, font-size
 * >= 16px on the input to avoid iOS zoom) and self-contained (no portal) so it works
 * inline inside each reference row.
 */
export function SearchableEntitySelect({
  options,
  value,
  onChange,
  ariaLabel,
  placeholder = 'Search…',
  disabled = false,
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const selected = useMemo(() => options.find((o) => o.id === value) ?? null, [options, value]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.name.toLowerCase().includes(q));
  }, [options, query]);

  // Clamp the highlighted row on read so a shrinking filtered list can never point
  // past the end. Derived (not an effect) to avoid a setState-in-effect cascade.
  const safeIndex =
    filtered.length === 0 ? 0 : Math.min(Math.max(activeIndex, 0), filtered.length - 1);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  // Scroll the active option into view while arrowing.
  useEffect(() => {
    if (!open) return;
    const el = document.getElementById(`${listId}-opt-${safeIndex}`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [safeIndex, open, listId]);

  function openMenu() {
    if (disabled) return;
    setOpen(true);
    setQuery('');
    // Highlight the current selection if present, else the first row.
    const idx = selected ? options.findIndex((o) => o.id === selected.id) : 0;
    setActiveIndex(idx >= 0 ? idx : 0);
  }

  function commit(opt: EntityOption | undefined) {
    if (!opt) return;
    onChange(opt.id);
    setOpen(false);
    setQuery('');
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      commit(filtered[safeIndex]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      setQuery('');
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActiveIndex(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActiveIndex(filtered.length - 1);
    }
  }

  const activeOptionId =
    open && filtered[safeIndex] ? `${listId}-opt-${safeIndex}` : undefined;

  return (
    <div ref={wrapRef} className={`relative ${className ?? ''}`}>
      <button
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
        aria-activedescendant={activeOptionId}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
        className={`flex min-h-9 w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors disabled:opacity-50 ${
          open
            ? 'border-brand-300 bg-white ring-1 ring-brand-200'
            : 'border-slate-200 bg-white hover:border-slate-300'
        }`}
      >
        <span className={`min-w-0 truncate ${selected ? 'text-slate-900' : 'text-slate-400'}`}>
          {selected ? selected.name : 'Choose…'}
        </span>
        <svg
          className="h-3.5 w-3.5 shrink-0 text-slate-400"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 right-0 z-30 mt-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg shadow-slate-900/10">
          <div className="border-b border-slate-100 p-1.5">
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={onKeyDown}
              placeholder={placeholder}
              aria-label={`${ariaLabel} — search`}
              aria-controls={listId}
              aria-activedescendant={activeOptionId}
              className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-base text-slate-900 outline-none focus:border-brand-300 focus:ring-1 focus:ring-brand-200 sm:text-sm"
            />
          </div>
          <ul id={listId} role="listbox" aria-label={ariaLabel} className="max-h-60 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-xs text-slate-500">No matches for “{query}”.</li>
            ) : (
              filtered.map((opt, i) => {
                const isActive = i === safeIndex;
                const isSelected = opt.id === value;
                return (
                  <li
                    id={`${listId}-opt-${i}`}
                    key={opt.id}
                    role="option"
                    aria-selected={isSelected}
                    onMouseEnter={() => setActiveIndex(i)}
                    onMouseDown={(e) => {
                      // Prevent the input blur from closing before the click registers.
                      e.preventDefault();
                      commit(opt);
                    }}
                    className={`flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-xs ${
                      isActive ? 'bg-brand-50 text-brand-900' : 'text-slate-700'
                    }`}
                  >
                    <span className="min-w-0 truncate">{opt.name}</span>
                    {isSelected && (
                      <svg
                        className="h-3.5 w-3.5 shrink-0 text-brand-600"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={2.5}
                        stroke="currentColor"
                        aria-hidden
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                    )}
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
