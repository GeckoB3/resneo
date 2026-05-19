'use client';

import {
  BookingCardInfo,
  type BookingCardDensity,
  type BookingCardInfoProps,
  type BookingCardLayout,
} from './BookingCardInfo';

export type { BookingCardDensity, BookingCardLayout };

export interface BookingCardProps extends BookingCardInfoProps {
  /** `compact` shows fewer fields in short calendar bars; `comfortable` is the default. */
  density?: BookingCardDensity;
  /** `reception` prioritises time · name · status; calendar bars use `legacy` (name-first). */
  layout?: BookingCardLayout;
}

/**
 * Calendar booking bar content — wraps {@link BookingCardInfo} with density and layout presets.
 */
export function BookingCard({
  density = 'comfortable',
  layout = 'legacy',
  ...props
}: BookingCardProps) {
  return <BookingCardInfo {...props} density={density} layout={layout} />;
}
