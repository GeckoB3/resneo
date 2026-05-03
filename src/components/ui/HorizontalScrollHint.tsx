/**
 * Shown below a breakpoint when wide content lives in a horizontal scroll container.
 * @param below - `sm`: show only on very narrow viewports. `lg`: hide from `lg` up. `xl`: hide from `xl` up (matches 7‑day strips that scroll below `xl`).
 */
export function HorizontalScrollHint({
  below = 'sm',
  message,
}: {
  below?: 'sm' | 'lg' | 'xl';
  /** Override default swipe hint copy */
  message?: string;
}) {
  const bp =
    below === 'xl' ? 'xl:hidden' : below === 'lg' ? 'lg:hidden' : 'sm:hidden';
  return (
    <p className={`mb-2 text-xs text-slate-500 ${bp}`} role="note">
      {message ?? 'Swipe horizontally to see all columns.'}
    </p>
  );
}
