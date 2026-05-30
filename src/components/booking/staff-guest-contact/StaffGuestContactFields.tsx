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
}

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
}: StaffGuestContactFieldsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const blurTimeoutRef = useRef<number | null>(null);
  const [activeField, setActiveField] = useState<StaffGuestContactFieldKey | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const searchQuery = activeField ? values[activeField].trim() : '';
  const { results, loading, error, showHint, showEmpty, minQueryLength } = useGuestToolbarSearch(searchQuery);

  const clearBlurTimeout = useCallback(() => {
    if (blurTimeoutRef.current != null) {
      window.clearTimeout(blurTimeoutRef.current);
      blurTimeoutRef.current = null;
    }
  }, []);

  const handleFieldFocus = useCallback(
    (field: StaffGuestContactFieldKey) => {
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
    },
    [clearBlurTimeout, onContactSelected, onFieldChange],
  );

  const showDropdown =
    dropdownOpen &&
    activeField !== null &&
    (searchQuery.length > 0 || loading || results.length > 0 || showEmpty || Boolean(error));

  const resolvedPhoneInputClassName =
    phoneInputClassName ??
    `${inputClassName} min-w-0`;

  return (
    <div ref={containerRef} className="relative space-y-4">
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
          <p className="mt-1 text-xs text-slate-500">Bookings use your signed-in Resneo email.</p>
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

      {showDropdown ? (
        <GuestContactAutocompleteDropdown
          results={results}
          loading={loading}
          error={error}
          showHint={showHint}
          showEmpty={showEmpty}
          minQueryLength={minQueryLength}
          onSelect={handleSelectContact}
        />
      ) : null}
    </div>
  );
}
