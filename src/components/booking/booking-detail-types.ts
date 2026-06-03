export type BookingDetailPresentation = 'drawer' | 'popover' | 'modal';

const PANEL_CHROME =
  'border border-slate-200/80 bg-white shadow-2xl shadow-slate-900/15 ring-1 ring-slate-100';

/** Inner panel classes for {@link BookingDetailSurface} across loading and loaded states. */
export function bookingDetailPanelClassName(
  presentation: BookingDetailPresentation,
  kind: 'loading' | 'drawer' | 'popover' | 'modal' | 'expanded-popover',
): string {
  // Gentle entrance for floating presentations (the drawer slides in separately).
  const popIn = ' booking-panel-animate-in';
  switch (kind) {
    case 'loading':
      if (presentation === 'popover') {
        return `flex max-h-[inherit] min-w-0 max-w-full w-full flex-col overflow-x-hidden overflow-y-auto rounded-2xl ${PANEL_CHROME}${popIn}`;
      }
      if (presentation === 'modal') {
        return `flex w-full min-w-0 max-w-2xl flex-col rounded-t-2xl ${PANEL_CHROME} sm:rounded-2xl${popIn}`;
      }
      return `flex w-full max-w-sm flex-col border-l ${PANEL_CHROME} lg:rounded-l-2xl`;
    case 'drawer':
      return `w-full max-w-md overflow-y-auto border-l ${PANEL_CHROME} lg:rounded-l-2xl`;
    case 'popover':
      return `flex max-h-[inherit] min-w-0 max-w-full w-full flex-col overflow-x-hidden overflow-y-auto rounded-2xl ${PANEL_CHROME}${popIn}`;
    case 'modal':
      return `flex w-full min-w-0 max-w-2xl flex-col rounded-t-2xl ${PANEL_CHROME} sm:rounded-2xl${popIn}`;
    case 'expanded-popover':
      return `max-h-[inherit] min-w-0 max-w-full overflow-x-hidden overflow-y-auto rounded-2xl ${PANEL_CHROME}${popIn}`;
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}
