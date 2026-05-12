/**
 * Single source of truth for guest/SMS phone numbers: E.164 via libphonenumber-js.
 */

import {
  parsePhoneNumberFromString,
  getCountries,
  getCountryCallingCode,
  type CountryCode,
} from 'libphonenumber-js';

export type { CountryCode };

const GB_FIRST_ORDER = (a: string, b: string) => {
  if (a === 'GB') return -1;
  if (b === 'GB') return 1;
  return a.localeCompare(b);
};

/** ISO country codes with calling codes, GB first (NI/UK primary market). */
export function getSortedCountryCodes(): CountryCode[] {
  return (getCountries() as CountryCode[]).sort(GB_FIRST_ORDER);
}

export function getDialCodeForCountry(country: CountryCode): string {
  return `+${getCountryCallingCode(country)}`;
}

/**
 * Parse user input to E.164. Uses defaultCountry for national numbers (e.g. 07725… + GB → +447725…).
 */
export function normalizeToE164(
  input: string,
  defaultCountry: CountryCode = 'GB',
): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let parsed = parsePhoneNumberFromString(trimmed, defaultCountry);
  if (parsed?.isValid()) return parsed.format('E.164');

  parsed = parsePhoneNumberFromString(trimmed);
  if (parsed?.isValid()) return parsed.format('E.164');

  return null;
}

/**
 * Best-effort: normalize for storage when validation is lenient (legacy rows).
 * If invalid, returns trimmed string or null.
 */
export function normalizeToE164Lenient(
  input: string,
  defaultCountry: CountryCode = 'GB',
): string | null {
  const strict = normalizeToE164(input, defaultCountry);
  if (strict) return strict;

  const trimmed = input.trim();
  if (!trimmed) return null;

  const parsed = parsePhoneNumberFromString(trimmed, defaultCountry);
  if (parsed?.isPossible()) return parsed.format('E.164');

  const parsedIntl = parsePhoneNumberFromString(trimmed);
  if (parsedIntl?.isPossible()) return parsedIntl.format('E.164');

  return null;
}

export interface PhoneUiParts {
  countryCode: CountryCode;
  /** National significant number (no country code, typically no leading trunk 0). */
  nationalNumber: string;
}

/**
 * Split stored DB value (E.164 or legacy national) into country + national for the phone UI.
 */
export function parseStoredPhoneForUi(
  stored: string | null | undefined,
  fallbackCountry: CountryCode = 'GB',
): PhoneUiParts {
  if (!stored?.trim()) {
    return { countryCode: fallbackCountry, nationalNumber: '' };
  }

  const trimmed = stored.trim();

  let parsed = parsePhoneNumberFromString(trimmed);
  if (parsed?.isValid()) {
    return {
      countryCode: (parsed.country ?? fallbackCountry) as CountryCode,
      nationalNumber: parsed.nationalNumber,
    };
  }

  parsed = parsePhoneNumberFromString(trimmed, fallbackCountry);
  if (parsed?.isValid()) {
    return {
      countryCode: (parsed.country ?? fallbackCountry) as CountryCode,
      nationalNumber: parsed.nationalNumber,
    };
  }

  // Legacy UK-ish: +44 or 44 prefix
  const digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('+') && digits.startsWith('44') && digits.length >= 12) {
    const national = digits.slice(2).replace(/^0+/, '') || digits.slice(2);
    return { countryCode: 'GB', nationalNumber: national };
  }

  if (digits.startsWith('44') && digits.length >= 12) {
    const national = digits.slice(2).replace(/^0+/, '') || digits.slice(2);
    return { countryCode: 'GB', nationalNumber: national };
  }

  // National number only - strip leading 0 for UK-style
  const national = digits.replace(/^0+/, '');
  return { countryCode: fallbackCountry, nationalNumber: national };
}

/**
 * Combine selected country and national digits into one string for parsing.
 */
export function composeNationalAndCountry(
  nationalDigits: string,
  countryCode: CountryCode,
): string {
  const digits = nationalDigits.replace(/\D/g, '');
  if (!digits) return '';
  const cc = getCountryCallingCode(countryCode);
  return `+${cc}${digits}`;
}

/**
 * Human-readable national format for dashboard lists (e.g. calendar cards).
 * Falls back to trimmed raw string when libphonenumber cannot parse.
 */
export function formatPhoneForDisplay(stored: string | null | undefined): string | null {
  if (!stored?.trim()) return null;
  const trimmed = stored.trim();
  const parsed = parsePhoneNumberFromString(trimmed);
  if (parsed?.isValid()) return parsed.formatNational();
  const parsedGb = parsePhoneNumberFromString(trimmed, 'GB');
  if (parsedGb?.isValid()) return parsedGb.formatNational();
  return trimmed;
}
