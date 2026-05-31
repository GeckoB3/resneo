/**
 * Public booking-page branding (Phase 1 of the Booking Site Studio).
 *
 * A venue stores a small `booking_page_config` blob. From the chosen primary colour we
 * derive a full 50–900 tint ramp and emit it as CSS custom properties, overriding the
 * `--color-brand-*` variables the whole `/book` flow already consumes — so the booking
 * page re-skins to the venue's brand with no per-component changes.
 */

export interface BookingPageSocialLinks {
  instagram?: string | null;
  facebook?: string | null;
  tiktok?: string | null;
  x?: string | null;
}

/** Curated font-pairing presets for the booking page (keys only; fonts loaded in the page). */
export const BOOKING_FONT_PRESET_KEYS = [
  'default',
  'modern',
  'elegant',
  'editorial',
  'rounded',
] as const;
export type BookingFontPreset = (typeof BOOKING_FONT_PRESET_KEYS)[number];

export function isBookingFontPreset(value: unknown): value is BookingFontPreset {
  return typeof value === 'string' && (BOOKING_FONT_PRESET_KEYS as readonly string[]).includes(value);
}

/** Human labels for the font presets (used by the settings editor). */
export const BOOKING_FONT_PRESET_LABELS: Record<BookingFontPreset, string> = {
  default: 'Clean (Inter)',
  modern: 'Modern (Poppins)',
  elegant: 'Elegant (Cormorant)',
  editorial: 'Editorial (Lora)',
  rounded: 'Rounded (Nunito)',
};

export interface BookingPageConfig {
  /** Brand primary as `#rrggbb`; drives the booking-page colour ramp. */
  brand_primary?: string | null;
  /** Optional accent as `#rrggbb`; falls back to the primary when unset. */
  brand_accent?: string | null;
  /** Curated heading/body font pairing. */
  font_preset?: BookingFontPreset | null;
  /** Short "about / welcome" text shown under the header. */
  about?: string | null;
  /** Announcement banner shown at the very top of the page. */
  announcement?: string | null;
  social_links?: BookingPageSocialLinks | null;
  /** Public photo gallery: ordered list of image URLs (stored in `venue-gallery` bucket). */
  gallery?: string[] | null;
}

/** Maximum gallery photos shown on the booking page. */
export const BOOKING_GALLERY_MAX = 12;

/** One-click colour palettes shown in the settings editor. */
export const BOOKING_THEME_PRESETS: Array<{
  key: string;
  label: string;
  primary: string;
  accent: string;
}> = [
  { key: 'navy', label: 'Resneo Navy', primary: '#003b6f', accent: '#00c2c7' },
  { key: 'forest', label: 'Forest', primary: '#14532d', accent: '#65a30d' },
  { key: 'plum', label: 'Plum', primary: '#6b21a8', accent: '#db2777' },
  { key: 'charcoal', label: 'Charcoal', primary: '#1f2937', accent: '#f59e0b' },
  { key: 'rose', label: 'Rose', primary: '#9f1239', accent: '#fb7185' },
  { key: 'ocean', label: 'Ocean', primary: '#0e7490', accent: '#22d3ee' },
];

const ABOUT_MAX = 2000;
const ANNOUNCEMENT_MAX = 300;
const SOCIAL_MAX = 300;

const HEX_RE = /^#?([0-9a-fA-F]{6})$/;

/** Normalise any input to `#rrggbb` lowercase, or null when invalid/empty. */
export function normalizeHexColor(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const m = HEX_RE.exec(trimmed);
  if (!m) return null;
  return `#${m[1]!.toLowerCase()}`;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function hexToRgb(hex: string): Rgb {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function rgbToHex({ r, g, b }: Rgb): string {
  const toHex = (n: number) => clampByte(n).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** Linear blend of two colours; `t` is the weight of `b` (0 → all `a`, 1 → all `b`). */
function mix(a: Rgb, b: Rgb, t: number): Rgb {
  const w = Math.max(0, Math.min(1, t));
  return {
    r: a.r * (1 - w) + b.r * w,
    g: a.g * (1 - w) + b.g * w,
    b: a.b * (1 - w) + b.b * w,
  };
}

const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const BLACK: Rgb = { r: 0, g: 0, b: 0 };

/** Tailwind-style brand stops; 600 is the anchor (= the chosen colour). */
export type BrandStop = 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;

/** How far each stop is mixed toward white (negative weight) or black (positive). */
const STOP_MIX: Record<BrandStop, number> = {
  50: -0.92,
  100: -0.84,
  200: -0.7,
  300: -0.52,
  400: -0.3,
  500: -0.14,
  600: 0,
  700: 0.18,
  800: 0.34,
  900: 0.5,
};

/** Build a monotonic light→dark ramp from a single primary, anchored at 600 = primary. */
export function buildBrandRamp(primaryHex: string): Record<BrandStop, string> {
  const base = hexToRgb(primaryHex);
  const out = {} as Record<BrandStop, string>;
  for (const stop of Object.keys(STOP_MIX) as unknown as BrandStop[]) {
    const weight = STOP_MIX[stop];
    if (weight === 0) {
      out[stop] = rgbToHex(base);
    } else if (weight < 0) {
      out[stop] = rgbToHex(mix(base, WHITE, -weight));
    } else {
      out[stop] = rgbToHex(mix(base, BLACK, weight));
    }
  }
  return out;
}

/** Relative luminance (sRGB) for contrast decisions. */
function relativeLuminance({ r, g, b }: Rgb): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two colours (1–21). */
export function contrastRatio(aHex: string, bHex: string): number {
  const la = relativeLuminance(hexToRgb(aHex));
  const lb = relativeLuminance(hexToRgb(bHex));
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Readable text colour (#fff or near-black) for a solid background. */
export function readableTextColor(bgHex: string): string {
  return contrastRatio(bgHex, '#ffffff') >= contrastRatio(bgHex, '#0f172a') ? '#ffffff' : '#0f172a';
}

/**
 * True when white text on this background is hard to read (a brand primary that's too
 * light for the page's solid buttons). The settings UI surfaces this as a warning.
 */
export function primaryNeedsDarkText(primaryHex: string): boolean {
  return contrastRatio(primaryHex, '#ffffff') < 3.5;
}

/**
 * CSS custom properties that override the brand ramp for the booking page. Returns an
 * empty object when no primary is configured (page keeps the default Resneo theme).
 */
export function bookingPageThemeVars(
  config: BookingPageConfig | null | undefined,
): Record<string, string> {
  const primary = normalizeHexColor(config?.brand_primary);
  if (!primary) return {};

  const ramp = buildBrandRamp(primary);
  // Override the :root base vars; the Tailwind `brand-*` utilities reference these
  // (see globals.css `@theme inline`), so the whole booking page re-skins.
  const vars: Record<string, string> = {
    '--brand': ramp[600],
    '--brand-dark': ramp[700],
    '--brand-light': ramp[100],
    // The appointment public flow themes itself from `--accent` (→ `--ap-accent`):
    // point it at the brand primary so cards, progress, buttons and the accent bar re-skin.
    '--accent': ramp[600],
  };
  for (const stop of Object.keys(ramp) as unknown as BrandStop[]) {
    vars[`--brand-${stop}`] = ramp[stop];
  }

  const accent = normalizeHexColor(config?.brand_accent);
  if (accent) {
    const accentRamp = buildBrandRamp(accent);
    vars['--brand-accent'] = accentRamp[600];
    for (const stop of Object.keys(accentRamp) as unknown as BrandStop[]) {
      vars[`--accent-${stop}`] = accentRamp[stop];
    }
  }

  return vars;
}

function trimToNull(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  if (!t) return null;
  return t.slice(0, max);
}

function sanitizeSocialLinks(raw: unknown): BookingPageSocialLinks | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as Record<string, unknown>;
  const out: BookingPageSocialLinks = {};
  for (const key of ['instagram', 'facebook', 'tiktok', 'x'] as const) {
    const value = trimToNull(src[key], SOCIAL_MAX);
    if (value) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Server-side normaliser for a stored `booking_page_config` (PATCH /api/venue). Drops
 * invalid colours, trims/caps copy, and keeps only known social fields, so the column
 * always holds a clean, predictable shape.
 */
export function sanitizeBookingPageConfig(raw: unknown): BookingPageConfig {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const config: BookingPageConfig = {};

  const primary = normalizeHexColor(typeof src.brand_primary === 'string' ? src.brand_primary : null);
  if (primary) config.brand_primary = primary;

  const accent = normalizeHexColor(typeof src.brand_accent === 'string' ? src.brand_accent : null);
  if (accent) config.brand_accent = accent;

  if (isBookingFontPreset(src.font_preset) && src.font_preset !== 'default') {
    config.font_preset = src.font_preset;
  }

  const about = trimToNull(src.about, ABOUT_MAX);
  if (about) config.about = about;

  const announcement = trimToNull(src.announcement, ANNOUNCEMENT_MAX);
  if (announcement) config.announcement = announcement;

  const social = sanitizeSocialLinks(src.social_links);
  if (social) config.social_links = social;

  const gallery = sanitizeGallery(src.gallery);
  if (gallery.length > 0) config.gallery = gallery;

  return config;
}

function sanitizeGallery(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const url = item.trim();
    if (!url || url.length > 2000) continue;
    if (!/^https?:\/\//i.test(url)) continue;
    if (!out.includes(url)) out.push(url);
    if (out.length >= BOOKING_GALLERY_MAX) break;
  }
  return out;
}
