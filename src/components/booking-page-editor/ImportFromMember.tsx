'use client';

import { useEffect, useRef, useState } from 'react';
import type { ImportSource } from './types';

/** Which part of the page a member's settings are copied into. */
export type ImportScope = 'all' | 'book_now' | 'about';

interface ImportFromMemberProps {
  sources: ImportSource[];
  scope: ImportScope;
  /** Button label, e.g. "Start from a member's page" or "Import from…". */
  label: string;
  onImport: (source: ImportSource, scope: ImportScope) => void;
  disabled?: boolean;
  /** Compact (per-section link) vs prominent (top-level) styling. */
  variant?: 'prominent' | 'compact';
}

/**
 * Dropdown that copies a member venue's saved booking-page settings into the editor.
 * Renders nothing when there are no sources (so single venues show no import UI).
 */
export function ImportFromMember({
  sources,
  scope,
  label,
  onImport,
  disabled,
  variant = 'compact',
}: ImportFromMemberProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  if (sources.length === 0) return null;

  const triggerClass =
    variant === 'prominent'
      ? 'inline-flex items-center gap-1.5 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-sm font-semibold text-brand-700 shadow-sm transition-colors hover:border-brand-300 hover:bg-brand-100 disabled:opacity-50'
      : 'inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-800 disabled:opacity-50';

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={triggerClass}
      >
        {label}
        <svg
          className="h-3.5 w-3.5"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2.2}
          stroke="currentColor"
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute left-0 z-20 mt-1 max-h-64 w-56 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-lg sm:left-auto sm:right-0"
        >
          {sources.map((s) => (
            <button
              key={s.venueId}
              type="button"
              role="menuitem"
              onClick={() => {
                onImport(s, scope);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
            >
              <span className="truncate">{s.venueName}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
