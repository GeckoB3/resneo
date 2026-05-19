'use client';

import { useMemo } from 'react';
import type { StaffSurfaceBookingStackProps } from '@/components/booking/StaffSurfaceBookingStack';
import { StaffSurfaceBookingStack } from '@/components/booking/StaffSurfaceBookingStack';
import { Dialog } from '@/components/ui/primitives/Dialog';

/** YYYY-MM-DD and HH:mm in the browser local calendar (matches UnifiedBookingForm / staff flows). */
function localCalendarNowParts(): { date: string; time: string } {
  const d = new Date();
  return {
    date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
  };
}

type Props = Omit<StaffSurfaceBookingStackProps, 'onCreated' | 'bookingIntent'> & {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  title?: string;
  bookingIntent?: 'new' | 'walk-in';
};

/**
 * Modal shell for staff multi-surface booking flows (same surfaces as /dashboard/bookings/new).
 * Tabs appear only when the venue exposes more than one booking surface.
 */
export function DashboardStaffBookingModal({
  open,
  onClose,
  onCreated,
  title = 'New booking',
  bookingIntent = 'new',
  ...stack
}: Props) {
  const nowParts = useMemo(() => (open ? localCalendarNowParts() : null), [open]);

  if (!open || !nowParts) return null;

  const { date: modalInitialDate, time: modalInitialTime } = nowParts;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={title}
      size="lg"
      contentClassName="max-w-5xl"
    >
      <StaffSurfaceBookingStack
        {...stack}
        bookingIntent={bookingIntent}
        onCreated={onCreated}
        onClose={onClose}
        initialDate={modalInitialDate}
        initialTime={modalInitialTime}
      />
    </Dialog>
  );
}
