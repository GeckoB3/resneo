import { cn } from './cn';

/**
 * Large brand loading spinner: a full light track with a brand-coloured head.
 *
 * Colours target the `--brand-*` variables directly instead of `border-brand-*`
 * utilities: the unlayered `.appointment-public` skin remaps those utility classes
 * (flattening the head colour), while venue-branded booking pages override the
 * `--brand-*` ramp inline (see bookingPageThemeVars), so var() references re-skin
 * correctly on every surface.
 *
 * Pass sizing (and positioning) through `className`; defaults to `h-8 w-8`.
 */
export function BrandSpinner({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <div
      aria-hidden={true}
      className={cn(
        'animate-spin rounded-full border-4 border-[color:var(--brand-200)] border-t-[color:var(--brand-600)]',
        className,
      )}
    />
  );
}
