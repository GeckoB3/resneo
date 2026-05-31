/**
 * Booking-page font presets (client-safe). Faces are loaded via `BOOKING_FONT_STYLESHEET`
 * on the public booking layout and in the dashboard font-style picker.
 */
import type { BookingFontPreset } from '@/lib/booking/booking-page-theme';

/** Whether the preset changes body text (`font-sans` / `--font-geist-sans`) as well as headings. */
const PRESET_APPLIES_BODY: Record<BookingFontPreset, boolean> = {
  default: false,
  modern: false,
  elegant: false,
  editorial: false,
  rounded: true,
  luxury: false,
  montserrat: true,
  raleway: true,
  boutique: false,
  spa: false,
  josefin: true,
  cinzel: false,
};

/** Font stacks per preset (Google Fonts + system fallbacks). */
const PRESET_FONT_FAMILY: Record<BookingFontPreset, string> = {
  default: 'var(--font-geist-sans, ui-sans-serif, system-ui, sans-serif)',
  modern: 'Poppins, ui-sans-serif, sans-serif',
  elegant: '"Cormorant Garamond", Georgia, serif',
  editorial: 'Lora, Georgia, serif',
  rounded: 'Nunito, ui-sans-serif, sans-serif',
  luxury: '"Playfair Display", Georgia, serif',
  montserrat: 'Montserrat, ui-sans-serif, sans-serif',
  raleway: 'Raleway, ui-sans-serif, sans-serif',
  boutique: '"Great Vibes", cursive',
  spa: 'Marcellus, Georgia, serif',
  josefin: '"Josefin Sans", ui-sans-serif, sans-serif',
  cinzel: 'Cinzel, Georgia, serif',
};

/** Loads all booking preset faces (public `/book` pages and settings previews). */
export const BOOKING_FONT_STYLESHEET =
  'https://fonts.googleapis.com/css2?' +
  [
    'family=Poppins:wght@500;600;700',
    'family=Cormorant+Garamond:wght@500;600;700',
    'family=Lora:wght@500;600;700',
    'family=Nunito:wght@400;500;600;700',
    'family=Playfair+Display:wght@500;600;700',
    'family=Montserrat:wght@400;500;600;700',
    'family=Raleway:wght@500;600;700',
    'family=Great+Vibes',
    'family=Marcellus',
    'family=Josefin+Sans:wght@500;600;700',
    'family=Cinzel:wght@500;600;700',
  ].join('&') +
  '&display=swap';

/** @deprecated Use `BOOKING_FONT_STYLESHEET` — kept for older bundles / imports. */
export const BOOKING_FONT_SETTINGS_STYLESHEET = BOOKING_FONT_STYLESHEET;

/**
 * CSS variables to merge into the booking-page root style for a font preset.
 * `--font-heading` is consumed by the scoped heading rule in globals.css; overriding
 * `--font-geist-sans` re-fonts the body (Tailwind `font-sans` resolves to it).
 */
export function bookingPageFontVars(preset: BookingFontPreset | null | undefined): Record<string, string> {
  if (!preset || preset === 'default') return {};
  const family = PRESET_FONT_FAMILY[preset];
  const vars: Record<string, string> = { '--font-heading': family };
  if (PRESET_APPLIES_BODY[preset]) vars['--font-geist-sans'] = family;
  return vars;
}

/** `font-family` for settings UI samples (dropdown labels). */
export function bookingFontPresetFontFamily(preset: BookingFontPreset): string {
  return PRESET_FONT_FAMILY[preset];
}
