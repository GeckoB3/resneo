'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  BOOKING_FONT_SETTINGS_STYLESHEET,
  bookingFontPresetFontFamily,
} from '@/lib/booking/booking-page-font-presets';
import {
  BOOKING_FONT_PRESET_KEYS,
  BOOKING_FONT_PRESET_LABELS,
  type BookingFontPreset,
} from '@/lib/booking/booking-page-theme';

interface BookingFontPresetSelectProps {
  id: string;
  value: BookingFontPreset;
  onChange: (value: BookingFontPreset) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Font preset picker — each option is rendered in its preset typeface (a native select
 * cannot style individual options reliably across browsers).
 */
export function BookingFontPresetSelect({
  id,
  value,
  onChange,
  disabled = false,
  className = '',
}: BookingFontPresetSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const pick = useCallback(
    (key: BookingFontPreset) => {
      onChange(key);
      setOpen(false);
    },
    [onChange],
  );

  return (
    <div ref={rootRef} className="relative">
      <link rel="stylesheet" href={BOOKING_FONT_SETTINGS_STYLESHEET} />
      <button
        type="button"
        id={id}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => {
          if (!disabled) setOpen((o) => !o);
        }}
        className={`${className} flex w-full items-center justify-between gap-2 text-left disabled:cursor-not-allowed`}
        style={{ fontFamily: bookingFontPresetFontFamily(value) }}
      >
        <span className="truncate">{BOOKING_FONT_PRESET_LABELS[value]}</span>
        <svg
          className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      {open && !disabled ? (
        <ul
          id={listId}
          role="listbox"
          aria-labelledby={id}
          className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
        >
          {BOOKING_FONT_PRESET_KEYS.map((key) => (
            <li
              key={key}
              role="option"
              aria-selected={key === value}
              className={`cursor-pointer px-3 py-2.5 text-sm hover:bg-slate-50 ${
                key === value ? 'bg-slate-50 font-medium text-slate-900' : 'text-slate-700'
              }`}
              style={{ fontFamily: bookingFontPresetFontFamily(key) }}
              onClick={() => pick(key)}
            >
              {BOOKING_FONT_PRESET_LABELS[key]}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
