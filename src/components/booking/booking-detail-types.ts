export type BookingDetailPresentation = 'drawer' | 'popover' | 'modal';

const PANEL_CHROME =
  'border border-slate-200/80 bg-white shadow-2xl shadow-slate-900/15 ring-1 ring-slate-100';

/** Inner panel classes for {@link BookingDetailSurface} across loading and loaded states. */
export function bookingDetailPanelClassName(
  presentation: BookingDetailPresentation,
  kind: 'loading' | 'drawer' | 'popover' | 'modal' | 'expanded-popover',
): string {
  switch (kind) {
    case 'loading':
      if (presentation === 'popover') {
        return `flex max-h-[inherit] min-w-0 max-w-full w-full flex-col overflow-x-hidden overflow-y-auto rounded-2xl ${PANEL_CHROME}`;
      }
      if (presentation === 'modal') {
        return `flex h-[min(85dvh,85vh)] w-full max-w-2xl min-h-0 flex-col overflow-hidden rounded-t-2xl ${PANEL_CHROME} sm:rounded-2xl`;
      }
      return `flex w-full max-w-sm flex-col border-l ${PANEL_CHROME} lg:rounded-l-2xl`;
    case 'drawer':
      return `w-full max-w-md overflow-y-auto border-l ${PANEL_CHROME} lg:rounded-l-2xl`;
    case 'popover':
      return `flex max-h-[inherit] min-w-0 max-w-full w-full flex-col overflow-x-hidden overflow-y-auto rounded-2xl ${PANEL_CHROME}`;
    case 'modal':
      return `flex h-[min(85dvh,85vh)] w-full max-w-2xl min-h-0 flex-col overflow-hidden rounded-t-2xl ${PANEL_CHROME} sm:rounded-2xl`;
    case 'expanded-popover':
      return `max-h-[inherit] min-w-0 max-w-full overflow-x-hidden overflow-y-auto rounded-2xl ${PANEL_CHROME}`;
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}
