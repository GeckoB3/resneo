'use client';

import * as RadixDialog from '@radix-ui/react-dialog';
import { type ReactNode } from 'react';
import { cn } from './cn';
import { IconButton } from './IconButton';

export type DialogSize = 'sm' | 'md' | 'lg';

const sizeClasses: Record<DialogSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-3xl',
};

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: DialogSize;
  showClose?: boolean;
  hideHeader?: boolean;
  className?: string;
  contentClassName?: string;
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = 'md',
  showClose = true,
  hideHeader = false,
  className,
  contentClassName,
}: DialogProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay
          data-booking-detail-dismiss-exempt
          className={cn('fixed inset-0 z-[var(--z-modal)] bg-slate-900/30 backdrop-blur-[2px]', className)}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        />
        <RadixDialog.Content
          data-booking-detail-dismiss-exempt
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            'fixed left-1/2 top-1/2 z-[var(--z-modal)] flex max-h-[min(90dvh,90vh)] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl bg-white shadow-xl focus:outline-none',
            sizeClasses[size],
            contentClassName,
          )}
        >
          {hideHeader ? (
            <>
              <RadixDialog.Title className="sr-only">{title}</RadixDialog.Title>
              {description ? (
                <RadixDialog.Description className="sr-only">{description}</RadixDialog.Description>
              ) : null}
            </>
          ) : (
            <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-6 py-4">
              <div>
                <RadixDialog.Title className="text-lg font-semibold text-slate-900">{title}</RadixDialog.Title>
                {description ? (
                  <RadixDialog.Description className="mt-1 text-sm text-slate-600">{description}</RadixDialog.Description>
                ) : (
                  <RadixDialog.Description className="sr-only">{title}</RadixDialog.Description>
                )}
              </div>
              {showClose ? (
                <RadixDialog.Close asChild>
                  <IconButton aria-label="Close" size="sm" className="shrink-0">
                    <CloseIcon />
                  </IconButton>
                </RadixDialog.Close>
              ) : null}
            </header>
          )}
          <div
            className={cn(
              'min-h-0 flex-1 overflow-y-auto',
              hideHeader ? 'p-0' : 'px-6 py-4 pb-[max(1rem,env(safe-area-inset-bottom,0px))]',
            )}
          >
            {children}
          </div>
          {footer ? <footer className="shrink-0 border-t border-slate-100 px-6 py-4">{footer}</footer> : null}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

function CloseIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}


