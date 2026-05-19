'use client';

import { Dialog } from './Dialog';
import { Button } from './Button';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  cancelLabel?: string;
  destructive?: boolean;
}

/** Destructive or neutral confirmation — replaces hand-rolled confirm overlays. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  message,
  confirmLabel,
  onConfirm,
  cancelLabel = 'Cancel',
  destructive = true,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={message}
      size="sm"
      showClose={false}
      contentClassName="max-w-sm"
      footer={
        <div className="flex gap-2.5">
          <Button
            type="button"
            variant={destructive ? 'danger' : 'primary'}
            className="flex-1"
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
          >
            {confirmLabel}
          </Button>
          <Button type="button" variant="secondary" className="flex-1" onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
        </div>
      }
    >
      {null}
    </Dialog>
  );
}
