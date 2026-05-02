'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';
import { useDismissibleLayer } from '@/lib/ui/use-dismissible-layer';
import {
  getSortedCountryCodes,
  getDialCodeForCountry,
  parseStoredPhoneForUi,
} from '@/lib/phone/e164';

export function nationalToE164Client(national: string, country: CountryCode): string | null {
  const t = national.trim();
  if (!t) return null;
  const p = parsePhoneNumberFromString(t, country);
  if (p?.isValid()) return p.format('E.164');
  return null;
}

/* ── helpers ── */

function countryFlag(code: string): string {
  return [...code.toUpperCase()]
    .map((c) => String.fromCodePoint(0x1f1e6 - 65 + c.charCodeAt(0)))
    .join('');
}

let _displayNames: Intl.DisplayNames | null = null;
function countryName(code: string): string {
  try {
    _displayNames ??= new Intl.DisplayNames(['en'], { type: 'region' });
    return _displayNames.of(code) ?? code;
  } catch {
    return code;
  }
}

const POPULAR: CountryCode[] = ['GB', 'IE', 'US'];

function extractRadius(cls: string): string {
  for (const t of cls.split(/\s+/)) {
    if (/^rounded(-[a-z0-9]+)?$/.test(t)) return t;
  }
  return 'rounded-xl';
}

function innerInputClasses(cls: string): string {
  return cls
    .split(/\s+/)
    .filter(
      (t) =>
        !t.startsWith('border') &&
        !t.startsWith('rounded') &&
        !t.startsWith('focus:') &&
        !t.startsWith('bg-') &&
        t !== 'w-full' &&
        t !== 'min-w-0' &&
        t !== 'transition-colors',
    )
    .join(' ');
}

/* ── types ── */

export interface PhoneWithCountryFieldProps {
  id?: string;
  name?: string;
  /** Stored / submitted value: E.164 or empty string. */
  value: string;
  onChange: (e164: string) => void;
  disabled?: boolean;
  className?: string;
  error?: string | null;
  defaultCountry?: CountryCode;
  inputClassName?: string;
}

/* ── component ── */

export function PhoneWithCountryField({
  id: idProp,
  name,
  value,
  onChange,
  disabled,
  className = '',
  error,
  defaultCountry: defaultCountryProp,
  inputClassName = '',
}: PhoneWithCountryFieldProps) {
  const reactId = useId();
  const id = idProp ?? `phone-${reactId}`;
  /** Venue/booking region (+44 for GB); explicit prop overrides. */
  const baseDefault = defaultCountryProp ?? 'GB';

  const [countryCode, setCountryCode] = useState<CountryCode>(baseDefault);
  const [national, setNational] = useState('');
  /** After an invalid blur we clear the parent `value` but keep showing the typed national until the user edits. */
  const retainInvalidNationalRef = useRef(false);
  const [formatError, setFormatError] = useState<string | null>(null);
  const prevExternalValueRef = useRef<string | undefined>(undefined);
  const isFirstSyncRef = useRef(true);

  /* dropdown state */
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [pos, setPos] = useState({ top: 0, left: 0, width: 280 });

  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const countries = useMemo(() => getSortedCountryCodes(), []);

  /* sync from external value */
  useEffect(() => {
    const apply = () => {
      if (isFirstSyncRef.current) {
        isFirstSyncRef.current = false;
        const parts = parseStoredPhoneForUi(value || null, baseDefault);
        setCountryCode(parts.countryCode);
        setNational(parts.nationalNumber);
        prevExternalValueRef.current = value;
        return;
      }
      if (prevExternalValueRef.current === value) return;
      prevExternalValueRef.current = value;
      if (retainInvalidNationalRef.current && !value) {
        return;
      }
      const parts = parseStoredPhoneForUi(value || null, baseDefault);
      setCountryCode(parts.countryCode);
      setNational(parts.nationalNumber);
    };
    const id = requestAnimationFrame(apply);
    return () => cancelAnimationFrame(id);
  }, [value, baseDefault]);

  useEffect(() => {
    if (!error) return;
    const t = window.setTimeout(() => setFormatError(null), 0);
    return () => clearTimeout(t);
  }, [error]);

  /* emit to parent */
  const emit = (nextCountry: CountryCode, nextNational: string) => {
    const e164 = nationalToE164Client(nextNational, nextCountry);
    if (e164) {
      onChange(e164);
      prevExternalValueRef.current = e164;
      return;
    }
    if (!nextNational.trim()) {
      onChange('');
      prevExternalValueRef.current = '';
    }
  };

  const handleNationalChange = (raw: string) => {
    retainInvalidNationalRef.current = false;
    setFormatError(null);
    setNational(raw);
    emit(countryCode, raw);
  };

  const handleCountryChange = useCallback(
    (cc: CountryCode) => {
      setFormatError(null);
      setCountryCode(cc);
      const e164 = nationalToE164Client(national, cc);
      if (e164) {
        retainInvalidNationalRef.current = false;
        onChange(e164);
        prevExternalValueRef.current = e164;
      } else if (!national.trim()) {
        retainInvalidNationalRef.current = false;
        onChange('');
        prevExternalValueRef.current = '';
      }
    },

    [national, onChange],
  );

  const handleBlur = () => {
    if (!national.trim()) {
      retainInvalidNationalRef.current = false;
      setFormatError(null);
      onChange('');
      prevExternalValueRef.current = '';
      return;
    }
    if (!nationalToE164Client(national, countryCode)) {
      setFormatError('That number is not valid for the selected country.');
      retainInvalidNationalRef.current = true;
      onChange('');
      prevExternalValueRef.current = '';
      return;
    }
    setFormatError(null);
    retainInvalidNationalRef.current = false;
  };

  /* ── dropdown logic ── */

  const filteredCountries = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) {
      const popular = POPULAR.filter((c) => countries.includes(c));
      const rest = countries.filter((c) => !POPULAR.includes(c));
      return { popular, rest };
    }
    const matched = countries.filter((cc) => {
      const n = countryName(cc).toLowerCase();
      const d = getDialCodeForCountry(cc);
      return n.includes(q) || cc.toLowerCase().includes(q) || d.includes(q);
    });
    return { popular: [] as CountryCode[], rest: matched };
  }, [countries, search]);

  const flatList = useMemo(
    () => [...filteredCountries.popular, ...filteredCountries.rest],
    [filteredCountries],
  );

  const openDropdown = useCallback(() => {
    if (disabled) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const dropH = 360;
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const openUp = spaceBelow < dropH && rect.top > dropH;
    const rawLeft = rect.left;
    const w = Math.max(280, rect.width + 140);
    const left = Math.min(rawLeft, window.innerWidth - w - 12);

    setPos({
      top: openUp ? rect.top - dropH - 4 : rect.bottom + 4,
      left: Math.max(8, left),
      width: w,
    });
    setSearch('');
    const idx = flatList.findIndex((cc) => cc === countryCode);
    setHighlighted(idx >= 0 ? idx : 0);
    setOpen(true);
    requestAnimationFrame(() => searchRef.current?.focus());
  }, [disabled, countryCode, flatList]);

  const closeDropdown = useCallback(() => {
    setOpen(false);
    setSearch('');
  }, []);

  const selectCountry = useCallback(
    (cc: CountryCode) => {
      handleCountryChange(cc);
      closeDropdown();
      requestAnimationFrame(() => document.getElementById(id)?.focus());
    },
    [handleCountryChange, closeDropdown, id],
  );

  useDismissibleLayer({
    open,
    refs: [triggerRef, dropdownRef],
    onDismiss: closeDropdown,
  });

  /* close on scroll / escape */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDropdown();
    };
    const onScroll = (e: Event) => {
      if (dropdownRef.current?.contains(e.target as Node)) return;
      closeDropdown();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, closeDropdown]);

  /* keyboard nav inside search */
  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setHighlighted((i) => Math.min(i + 1, flatList.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setHighlighted((i) => Math.max(i - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          if (flatList[highlighted]) selectCountry(flatList[highlighted]);
          break;
        case 'Escape':
          e.preventDefault();
          closeDropdown();
          break;
      }
    },
    [flatList, highlighted, selectCountry, closeDropdown],
  );

  /* scroll highlighted row into view */
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector(`[data-idx="${highlighted}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlighted, open]);

  /* ── derived styling ── */

  const radius = extractRadius(inputClassName || 'rounded-xl');
  const cleanInput = innerInputClasses(
    inputClassName || 'px-4 py-2.5 text-sm placeholder:text-slate-300',
  );

  const combinedError = error ?? formatError;

  return (
    <div className={className}>
      <div
        className={`flex w-full min-w-0 items-stretch overflow-hidden border bg-white transition-colors focus-within:ring-2 ${radius} ${disabled ? 'opacity-50' : ''} ${
          combinedError
            ? 'border-red-400 focus-within:border-red-500 focus-within:ring-red-500/25'
            : 'border-slate-200 focus-within:border-brand-500 focus-within:ring-brand-500/20'
        }`}
      >
        <label htmlFor={id} className="sr-only">
          Mobile number
        </label>

        {/* country trigger */}
        <button
          ref={triggerRef}
          type="button"
          disabled={disabled}
          onClick={() => (open ? closeDropdown() : openDropdown())}
          className={`inline-flex shrink-0 items-center gap-1.5 border-r border-slate-200 bg-slate-50/60 px-2.5 text-sm transition-colors hover:bg-slate-100/80 focus:outline-none disabled:cursor-not-allowed ${open ? 'bg-slate-100/80' : ''}`}
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label={`Country: ${countryName(countryCode)}`}
        >
          <span className="text-lg leading-none">{countryFlag(countryCode)}</span>
          <span className="font-medium tabular-nums text-slate-600">
            {getDialCodeForCountry(countryCode)}
          </span>
          <svg
            className={`h-3 w-3 text-slate-400 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="m19.5 8.25-7.5 7.5-7.5-7.5"
            />
          </svg>
        </button>

        {/* national number input */}
        <input
          id={id}
          name={name}
          type="tel"
          autoComplete="tel-national"
          disabled={disabled}
          value={national}
          onChange={(e) => handleNationalChange(e.target.value)}
          onBlur={handleBlur}
          placeholder="e.g. 7725 000 223"
          className={`min-w-0 flex-1 border-0 bg-transparent focus:outline-none focus:ring-0 disabled:cursor-not-allowed ${cleanInput}`}
        />
      </div>

      {/* dropdown portal */}
      {open &&
        mounted &&
        createPortal(
          <div
            ref={dropdownRef}
            role="listbox"
            className="fixed z-[9999] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
            style={{ top: pos.top, left: pos.left, width: pos.width }}
          >
            {/* search */}
            <div className="border-b border-slate-100 p-2">
              <div className="relative">
                <svg
                  className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
                  />
                </svg>
                <input
                  ref={searchRef}
                  type="text"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setHighlighted(0);
                  }}
                  onKeyDown={handleSearchKeyDown}
                  placeholder="Search countries..."
                  className="w-full rounded-lg border border-slate-200 bg-slate-50/80 py-2 pl-8 pr-3 text-sm placeholder:text-slate-400 focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-brand-500"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
            </div>

            {/* list */}
            <div ref={listRef} className="max-h-64 overflow-y-auto overscroll-contain p-1">
              {filteredCountries.popular.length > 0 && (
                <>
                  <div className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    Popular
                  </div>
                  {filteredCountries.popular.map((cc, i) => (
                    <CountryRow
                      key={cc}
                      code={cc}
                      idx={i}
                      isSelected={cc === countryCode}
                      isHighlighted={i === highlighted}
                      onSelect={selectCountry}
                      onHover={setHighlighted}
                    />
                  ))}
                  {filteredCountries.rest.length > 0 && (
                    <div className="mx-2 my-1.5 border-t border-slate-100" />
                  )}
                </>
              )}

              {filteredCountries.popular.length > 0 && filteredCountries.rest.length > 0 && (
                <div className="px-2.5 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  All countries
                </div>
              )}

              {filteredCountries.rest.length > 0
                ? filteredCountries.rest.map((cc, i) => {
                    const idx = filteredCountries.popular.length + i;
                    return (
                      <CountryRow
                        key={cc}
                        code={cc}
                        idx={idx}
                        isSelected={cc === countryCode}
                        isHighlighted={idx === highlighted}
                        onSelect={selectCountry}
                        onHover={setHighlighted}
                      />
                    );
                  })
                : filteredCountries.popular.length === 0 && (
                    <div className="px-3 py-8 text-center text-sm text-slate-400">
                      No countries found
                    </div>
                  )}
            </div>
          </div>,
          document.body,
        )}

      {combinedError ? <p className="mt-1 text-xs text-red-600">{combinedError}</p> : null}
    </div>
  );
}

/* ── single country row in the dropdown ── */

function CountryRow({
  code,
  idx,
  isSelected,
  isHighlighted,
  onSelect,
  onHover,
}: {
  code: CountryCode;
  idx: number;
  isSelected: boolean;
  isHighlighted: boolean;
  onSelect: (cc: CountryCode) => void;
  onHover: (idx: number) => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={isSelected}
      data-idx={idx}
      onClick={() => onSelect(code)}
      onMouseEnter={() => onHover(idx)}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
        isHighlighted
          ? 'bg-brand-50 text-brand-900'
          : 'text-slate-700 hover:bg-slate-50'
      }`}
    >
      <span className="shrink-0 text-lg leading-none">{countryFlag(code)}</span>
      <span className="min-w-0 flex-1 truncate">{countryName(code)}</span>
      <span className="shrink-0 tabular-nums text-xs text-slate-400">
        {getDialCodeForCountry(code)}
      </span>
      {isSelected && (
        <svg
          className="h-4 w-4 shrink-0 text-brand-600"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2.5}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="m4.5 12.75 6 6 9-13.5"
          />
        </svg>
      )}
    </button>
  );
}
