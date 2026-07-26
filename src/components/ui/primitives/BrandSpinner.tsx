import { cn } from './cn';

/**
 * Large brand loading spinner: a full light track with a brand-coloured head.
 *
 * Drawn as SVG strokes rather than CSS borders. Chromium paints a rounded
 * bordered box as four border segments joined at 45-degree miters, and while
 * the element rotates those joint seams alias differently at every angle,
 * flashing a hairline across the ring. A single continuous circle stroke has
 * no joints, so the artifact cannot occur.
 *
 * Colours target the `--brand-*` variables directly instead of brand utility
 * classes: the unlayered `.appointment-public` skin remaps those utilities,
 * while venue-branded booking pages override the `--brand-*` ramp inline (see
 * bookingPageThemeVars), so var() references re-skin correctly on every
 * surface.
 *
 * Pass sizing (and positioning) through `className`; defaults to `h-8 w-8`.
 * The stroke stays 4px at any rendered size (non-scaling), matching the
 * border-4 weight the design uses elsewhere.
 */
export function BrandSpinner({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <svg aria-hidden={true} viewBox="0 0 40 40" fill="none" className={cn('animate-spin', className)}>
      <circle cx="20" cy="20" r="18" stroke="var(--brand-200)" strokeWidth="4" vectorEffect="non-scaling-stroke" />
      {/* Quarter-circumference dash (2*pi*18 / 4), rotated so the head sits centred on top. */}
      <circle
        cx="20"
        cy="20"
        r="18"
        stroke="var(--brand-600)"
        strokeWidth="4"
        vectorEffect="non-scaling-stroke"
        strokeDasharray="28.274 84.823"
        transform="rotate(-135 20 20)"
      />
    </svg>
  );
}
