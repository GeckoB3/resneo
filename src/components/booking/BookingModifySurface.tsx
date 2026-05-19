'use client';

import { type ReactNode } from 'react';
import { Dialog } from '@/components/ui/primitives/Dialog';
import { Button } from '@/components/ui/primitives/Button';

export interface BookingModifySurfaceProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  onSave?: () => void;
  saveLabel?: string;
  saving?: boolean;
  saveDisabled?: boolean;
}

/**
 * Shared modify-booking dialog shell for appointment and C/D/E flows (P1.1 / C1.4).
 */
export function BookingModifySurface({
  open,
  onOpenChange,
  title,
  description,
  children,
  onSave,
  saveLabel = 'Save changes',
  saving = false,
  saveDisabled = false,
}: BookingModifySurfaceProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      size="md"
      footer={
        onSave ? (
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="button" variant="primary" loading={saving} disabled={saveDisabled} onClick={onSave}>
              {saveLabel}
            </Button>
          </div>
        ) : undefined
      }
    >
      {children}
    </Dialog>
  );
}
