/**
 * Curated booking-page fonts (Booking Site Studio). Loaded via `next/font/google` at the
 * page level. Only the font actually referenced by the active preset is downloaded by the
 * browser (others define `@font-face` but stay unused), so the class list can be attached
 * unconditionally. Body defaults to the app's Inter (`--font-geist-sans`); presets override
 * the heading font and, where noted, the body font.
 */
import { Poppins, Cormorant_Garamond, Lora, Nunito } from 'next/font/google';
import type { BookingFontPreset } from '@/lib/booking/booking-page-theme';

const poppins = Poppins({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  display: 'swap',
  preload: false,
  variable: '--bp-poppins',
});

const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  display: 'swap',
  preload: false,
  variable: '--bp-cormorant',
});

const lora = Lora({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  display: 'swap',
  preload: false,
  variable: '--bp-lora',
});

const nunito = Nunito({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  preload: false,
  variable: '--bp-nunito',
});

/** Attach to the booking-page root so all preset font variables are available. */
export const BOOKING_FONT_CLASSNAMES = [
  poppins.variable,
  cormorant.variable,
  lora.variable,
  nunito.variable,
].join(' ');

/** Heading / body CSS variable overrides per preset (null = keep app default Inter). */
const PRESET_FONTS: Record<BookingFontPreset, { heading: string | null; body: string | null }> = {
  default: { heading: null, body: null },
  modern: { heading: 'var(--bp-poppins)', body: null },
  elegant: { heading: 'var(--bp-cormorant)', body: null },
  editorial: { heading: 'var(--bp-lora)', body: null },
  rounded: { heading: 'var(--bp-nunito)', body: 'var(--bp-nunito)' },
};

/**
 * CSS variables to merge into the booking-page root style for a font preset.
 * `--font-heading` is consumed by the scoped heading rule in globals.css; overriding
 * `--font-geist-sans` re-fonts the body (Tailwind `font-sans` resolves to it).
 */
export function bookingPageFontVars(preset: BookingFontPreset | null | undefined): Record<string, string> {
  if (!preset || preset === 'default') return {};
  const fonts = PRESET_FONTS[preset];
  const vars: Record<string, string> = {};
  if (fonts.heading) vars['--font-heading'] = fonts.heading;
  if (fonts.body) vars['--font-geist-sans'] = fonts.body;
  return vars;
}
