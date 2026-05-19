'use client';

import { type CSSProperties, type ReactNode, type RefObject } from 'react';
import { Dialog } from '@/components/ui/primitives/Dialog';
import { Sheet } from '@/components/ui/primitives/Sheet';
import { cn } from '@/components/ui/primitives/cn';
import type { BookingDetailPresentation } from '@/components/booking/booking-detail-types';

export interface BookingDetailSurfaceProps {
  presentation: BookingDetailPresentation;
  onClose: () => void;
  panelRef: RefObject<HTMLDivElement | null>;
  panelShellStyle?: CSSProperties;
  popoverDismissLayer?: ReactNode;
  nestedBookingOpen?: boolean;
  panelClassName: string;
  children: ReactNode;
}

/**
 * Presentation chrome for booking detail (drawer / modal / calendar popover).
 * Body content is supplied by {@link BookingDetailPanel} until full extract to BookingDetailContent.
 */
export function BookingDetailSurface({
  presentation,
  onClose,
  panelRef,
  panelShellStyle,
  popoverDismissLayer,
  nestedBookingOpen,
  panelClassName,
  children,
}: BookingDetailSurfaceProps) {
  const isPopover = presentation === 'popover';
  const isModal = presentation === 'modal';

  const panelInner = (
    <div
      ref={panelRef}
      role={isPopover ? 'dialog' : 'region'}
      aria-modal={isPopover ? false : undefined}
      aria-label="Booking detail panel"
      className={panelClassName}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  );

  const handleOpenChange = (open: boolean) => {
    if (!open && !nestedBookingOpen) onClose();
  };

  if (isModal) {
    return (
      <>
        <Dialog
          open
          onOpenChange={handleOpenChange}
          title="Booking detail"
          hideHeader
          size="lg"
          showClose={false}
          contentClassName="flex h-[min(85dvh,85vh)] max-h-[min(90dvh,90vh)] w-full max-w-2xl flex-col overflow-hidden p-0"
        >
          {panelInner}
        </Dialog>
        {popoverDismissLayer}
      </>
    );
  }

  if (presentation === 'drawer') {
    return (
      <>
        <Sheet
          open
          onOpenChange={handleOpenChange}
          title="Booking detail"
          hideHeader
          showClose={false}
          side="right"
          contentClassName="flex h-full max-w-md flex-col overflow-hidden p-0 lg:max-w-lg"
        >
          {panelInner}
        </Sheet>
        {popoverDismissLayer}
      </>
    );
  }

  return (
    <>
      {popoverDismissLayer}
      <div className="fixed" style={panelShellStyle} onClick={undefined}>
        {panelInner}
      </div>
    </>
  );
}
