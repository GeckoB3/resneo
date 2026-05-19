'use client';

import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from './cn';

export type IconButtonSize = 'sm' | 'md' | 'lg';

const sizeClasses: Record<IconButtonSize, string> = {
  sm: 'h-8 w-8 rounded-lg',
  md: 'h-10 w-10 rounded-xl',
  lg: 'h-11 w-11 rounded-xl',
};

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required for accessibility when no visible text label. */
  'aria-label': string;
  size?: IconButtonSize;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { className, size = 'md', type = 'button', children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex shrink-0 items-center justify-center text-slate-500 transition-colors',
        'hover:bg-slate-100 hover:text-slate-700',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2',
        'disabled:pointer-events-none disabled:opacity-50',
        sizeClasses[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
});
