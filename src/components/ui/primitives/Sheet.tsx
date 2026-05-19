'use client';

import * as RadixDialog from '@radix-ui/react-dialog';
import { type ReactNode } from 'react';
import { cn } from './cn';
import { IconButton } from './IconButton';

export type SheetSide = 'right' | 'bottom';

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  side?: SheetSide;
  showClose?: boolean;
  hideHeader?: boolean;
  className?: string;
  contentClassName?: string;
}

export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  side = 'right',
  showClose = true,
  hideHeader = false,
  className,
  contentClassName,
}: SheetProps) {
  const isBottom = side === 'bottom';

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay
          className={cn('fixed inset-0 z-[var(--z-modal)] bg-slate-900/25 backdrop-blur-[2px]', className)}
        />
        <RadixDialog.Content
          className={cn(
            'fixed z-[var(--z-modal)] flex flex-col overflow-hidden bg-white shadow-xl focus:outline-none',
            isBottom
              ? 'inset-x-0 bottom-0 max-h-[min(92dvh,92vh)] w-full rounded-t-2xl sm:left-1/2 sm:right-auto sm:top-1/2 sm:max-h-[min(90dvh,90vh)] sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl'
              : 'inset-y-0 right-0 h-full w-full max-w-md border-l border-slate-200 sm:max-w-lg',
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
            <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-4 py-4 sm:px-6">
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
              hideHeader ? 'p-0' : 'px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom,0px))] sm:px-6',
            )}
          >
            {children}
          </div>
          {footer ? <footer className="shrink-0 border-t border-slate-100 px-4 py-4 sm:px-6">{footer}</footer> : null}
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
