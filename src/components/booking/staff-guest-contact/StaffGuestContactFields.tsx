'use client';

import { useCallback, useRef, useState } from 'react';
import type { CountryCode } from 'libphonenumber-js';
import { PhoneWithCountryField } from '@/components/phone/PhoneWithCountryField';
import { guestListRowToPrefill } from '@/components/dashboard/toolbar-guest-search/guest-search-helpers';
import { useGuestToolbarSearch } from '@/components/dashboard/toolbar-guest-search/useGuestToolbarSearch';
import type { GuestListRow } from '@/types/contacts';
import { GuestContactAutocompleteDropdown } from './GuestContactAutocompleteDropdown';

export type StaffGuestContactFieldKey = 'firstName' | 'lastName' | 'email' | 'phone';

export interface StaffGuestContactValues {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

export interface StaffGuestContactFieldsProps {
  values: StaffGuestContactValues;
  onFieldChange: (field: StaffGuestContactFieldKey, value: string) => void;
  phoneDefaultCountry: CountryCode;
  onContactSelected?: (row: GuestListRow) => void;
  emailReadOnly?: boolean;
  phoneRequired?: boolean;
  firstNameId?: string;
  lastNameId?: string;
  emailId?: string;
  phoneId?: string;
  firstNameRef?: React.RefObject<HTMLInputElement | null>;
  /** Tailwind classes for text inputs */
  inputClassName?: string;
  /** Tailwind classes for phone input */
  phoneInputClassName?: string;
  labelClassName?: string;
  /** When true, first/last name labels show "(optional)" */
  namesOptional?: boolean;
  emailOptional?: boolean;
  /**
   * The dedicated "Find an existing contact" box above the fields, as in the
   * mobile app's guest step. On by default; the per-field lookup stays too.
   */
  showSearchBox?: boolean;
  searchBoxId?: string;
}

/** The search box counts as a field for the shared dropdown state. */
type ActiveLookup = StaffGuestContactFieldKey | 'search';

export function StaffGuestContactFields({
  values,
  onFieldChange,
  phoneDefaultCountry,
  onContactSelected,
  emailReadOnly = false,
  phoneRequired = true,
  firstNameId = 'staff-guest-first-name',
  lastNameId = 'staff-guest-last-name',
  emailId = 'staff-guest-email',
  phoneId = 'staff-guest-phone',
  firstNameRef,
  inputClassName = 'min-h-[44px] w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-base placeholder:text-slate-300 focus:border-brand-500 focus:ring-1 focus:ring-brand-500',
  phoneInputClassName,
  labelClassName = 'mb-1.5 block text-sm font-medium text-slate-700',
  namesOptional = true,
  emailOptional = true,
  showSearchBox = true,
  searchBoxId = 'staff-guest-search',
}: StaffGuestContactFieldsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const blurTimeoutRef = useRef<number | null>(null);
  const [activeField, setActiveField] = useState<ActiveLookup | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [searchInput, setSearchInput] = useState('');

  const searchQuery =
    activeField === 'search' ? searchInput.trim() : activeField ? values[activeField].trim() : '';
  const { results, loading, error, showHint, showEmpty, minQueryLength } = useGuestToolbarSearch(searchQuery);

  const clearBlurTimeout = useCallback(() => {
    if (blurTimeoutRef.current != null) {
      window.clearTimeout(blurTimeoutRef.current);
      blurTimeoutRef.current = null;
    }
  }, []);

  const handleFieldFocus = useCallback(
    (field: ActiveLookup) => {
      clearBlurTimeout();
      setActiveField(field);
      setDropdownOpen(true);
    },
    [clearBlurTimeout],
  );

  const handleFieldBlur = useCallback(() => {
    clearBlurTimeout();
    blurTimeoutRef.current = window.setTimeout(() => {
      setActiveField(null);
      setDropdownOpen(false);
    }, 150);
  }, [clearBlurTimeout]);

  const handleFieldChange = useCallback(
    (field: StaffGuestContactFieldKey, value: string) => {
      onFieldChange(field, value);
      setActiveField(field);
      setDropdownOpen(true);
    },
    [onFieldChange],
  );

  const handleSelectContact = useCallback(
    (row: GuestListRow) => {
      const prefill = guestListRowToPrefill(row);
      if (prefill.firstName != null) onFieldChange('firstName', prefill.firstName);
      if (prefill.lastName != null) onFieldChange('lastName', prefill.lastName);
      if (prefill.email) onFieldChange('email', prefill.email);
      if (prefill.phone) onFieldChange('phone', prefill.phone);
      onContactSelected?.(row);
      clearBlurTimeout();
      setActiveField(null);
      setDropdownOpen(false);
      // As in the app: picking a contact empties the search box so the list folds away.
      setSearchInput('');
    },
    [clearBlurTimeout, onContactSelected, onFieldChange],
  );

  const dropdownHasContent =
    searchQuery.length > 0 || loading || results.length > 0 || showEmpty || Boolean(error);
  const showSearchDropdown = dropdownOpen && activeField === 'search' && dropdownHasContent;
  const showDropdown =
    dropdownOpen && activeField !== null && activeField !== 'search' && dropdownHasContent;

  const dropdownProps = { results, loading, error, showHint, showEmpty, minQueryLength, onSelect: handleSelectContact };

  const resolvedPhoneInputClassName =
    phoneInputClassName ??
    `${inputClassName} min-w-0`;

  return (
    <div ref={containerRef} className="relative space-y-4">
      {showSearchBox ? (
        <div>
          <label htmlFor={searchBoxId} className={labelClassName}>
            Find an existing contact <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <div className="relative">
            <svg
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
              aria-hidden
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.35-4.35M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z" />
            </svg>
            <input
              id={searchBoxId}
              type="text"
              role="combobox"
              aria-expanded={showSearchDropdown}
              aria-controls={`${searchBoxId}-results`}
              aria-autocomplete="list"
              autoComplete="off"
              enterKeyHint="search"
              value={searchInput}
              onChange={(e) => {
                setSearchInput(e.target.value);
                clearBlurTimeout();
                setActiveField('search');
                setDropdownOpen(true);
              }}
              onFocus={() => handleFieldFocus('search')}
              onBlur={handleFieldBlur}
              placeholder="Search by name, phone or email"
              className={`${inputClassName} pl-10${searchInput ? ' pr-16' : ''}`}
            />
            {searchInput ? (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setSearchInput('');
                  setDropdownOpen(false);
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-slate-500 hover:text-slate-800"
              >
                Clear
              </button>
            ) : null}
            {showSearchDropdown ? (
              <div id={`${searchBoxId}-results`}>
                <GuestContactAutocompleteDropdown {...dropdownProps} />
              </div>
            ) : null}
          </div>
          <div className="mt-3 flex items-center gap-3 text-[11px] font-medium uppercase tracking-wide text-slate-400">
            <span className="h-px flex-1 bg-slate-200" aria-hidden />
            or enter details
            <span className="h-px flex-1 bg-slate-200" aria-hidden />
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={firstNameId} className={labelClassName}>
            First name{' '}
            {namesOptional ? <span className="font-normal text-slate-400">(optional)</span> : null}
          </label>
          <input
            ref={firstNameRef}
            id={firstNameId}
            type="text"
            autoComplete="given-name"
            value={values.firstName}
            onChange={(e) => handleFieldChange('firstName', e.target.value)}
            onFocus={() => handleFieldFocus('firstName')}
            onBlur={handleFieldBlur}
            placeholder="First name"
            className={inputClassName}
          />
        </div>
        <div>
          <label htmlFor={lastNameId} className={labelClassName}>
            Surname{' '}
            {namesOptional ? <span className="font-normal text-slate-400">(optional)</span> : null}
          </label>
          <input
            id={lastNameId}
            type="text"
            autoComplete="family-name"
            value={values.lastName}
            onChange={(e) => handleFieldChange('lastName', e.target.value)}
            onFocus={() => handleFieldFocus('lastName')}
            onBlur={handleFieldBlur}
            placeholder="Surname"
            className={inputClassName}
          />
        </div>
      </div>

      <div>
        <label htmlFor={emailId} className={labelClassName}>
          Email{' '}
          {emailOptional ? <span className="font-normal text-slate-400">(optional)</span> : null}
        </label>
        <input
          id={emailId}
          type="email"
          autoComplete="email"
          value={values.email}
          onChange={(e) => handleFieldChange('email', e.target.value)}
          onFocus={() => handleFieldFocus('email')}
          onBlur={handleFieldBlur}
          readOnly={emailReadOnly}
          placeholder="you@example.com"
          className={`${inputClassName}${emailReadOnly ? ' cursor-not-allowed bg-slate-50 text-slate-600' : ''}`}
        />
        {emailReadOnly ? (
          <p className="mt-1 text-xs text-slate-500">Bookings use your signed-in ResNeo email.</p>
        ) : null}
      </div>

      <div>
        <label htmlFor={phoneId} className={labelClassName}>
          Phone{' '}
          {phoneRequired ? (
            <>
              <span className="text-red-400" aria-hidden="true">
                *
              </span>
              <span className="sr-only">(required)</span>
            </>
          ) : (
            <span className="font-normal text-slate-400">(optional)</span>
          )}
        </label>
        <div onFocus={() => handleFieldFocus('phone')} onBlur={handleFieldBlur}>
          <PhoneWithCountryField
            id={phoneId}
            value={values.phone}
            onChange={(value) => handleFieldChange('phone', value)}
            defaultCountry={phoneDefaultCountry}
            inputClassName={resolvedPhoneInputClassName}
          />
        </div>
      </div>

      {showDropdown ? <GuestContactAutocompleteDropdown {...dropdownProps} /> : null}
    </div>
  );
}
