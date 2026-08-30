'use client';

import type { ReactNode } from 'react';
import { Dialog } from './Dialog';
import { Button } from './Button';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /**
   * The one-line consequence, read out as the dialog's accessible description.
   * Stays a plain string on purpose: it is what a screen reader announces with
   * the title, so it must not become arbitrary markup.
   */
  message: string;
  /**
   * Optional structured content rendered beneath `message`, for consequences a
   * sentence cannot carry: a cancellation deadline, deposit refundability, a
   * card-hold fee, what stops and when (P0-16, blocks P2-2 and P2-6).
   * `message` remains required, so a caller adding a body cannot accidentally
   * leave the dialog without an accessible description.
   */
  body?: ReactNode;
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
  body,
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
      {body ?? null}
    </Dialog>
  );
}
