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
 * Best-guess default calling region for a venue from its ISO-4217 currency.
 *
 * National-format numbers (e.g. "06 12 34 56 78", "087 123 4567") carry no
 * country code, so libphonenumber needs a default region to parse them. Venues
 * have a `currency` but no explicit country, so we map the currency to its most
 * likely market. This only affects national-format numbers; international ones
 * (with + or a country code) parse regardless. Where a currency spans many
 * countries (notably EUR) the mapping is a heuristic the user can later override.
 */
export function defaultPhoneCountryFromCurrency(
  currency: string | null | undefined,
): CountryCode {
  const code = currency?.trim().toUpperCase();
  const MAP: Record<string, CountryCode> = {
    GBP: 'GB',
    EUR: 'IE', // primary EUR market for this app (Ireland); overridable per venue
    USD: 'US',
    CAD: 'CA',
    AUD: 'AU',
    NZD: 'NZ',
    CHF: 'CH',
    SEK: 'SE',
    NOK: 'NO',
    DKK: 'DK',
    PLN: 'PL',
    ZAR: 'ZA',
    AED: 'AE',
    INR: 'IN',
    JPY: 'JP',
    SGD: 'SG',
    HKD: 'HK',
  };
  return (code && MAP[code]) || 'GB';
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

/**
 * `tel:` URI for click-to-call. Prefer E.164; fall back to dial-safe digits from raw storage.
 */
export function phoneToTelHref(stored: string | null | undefined): string | null {
  if (!stored?.trim()) return null;
  const e164 = normalizeToE164Lenient(stored.trim(), 'GB');
  if (e164) return `tel:${e164}`;
  const digits = stored.replace(/[^\d+]/g, '');
  if (digits.length >= 6) return `tel:${digits}`;
  return null;
}
