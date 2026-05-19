'use client';

import { Slot } from '@radix-ui/react-slot';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from './cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg';

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-brand-600 text-white hover:bg-brand-700 focus-visible:ring-brand-600 disabled:bg-brand-300',
  secondary:
    'border border-slate-200 bg-white text-slate-800 hover:bg-slate-50 focus-visible:ring-brand-600 disabled:opacity-50',
  ghost: 'text-slate-700 hover:bg-slate-100 focus-visible:ring-brand-600 disabled:opacity-50',
  danger: 'bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-600 disabled:bg-red-300',
  link: 'text-brand-600 underline-offset-2 hover:underline focus-visible:ring-brand-600 p-0 h-auto min-h-0',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'min-h-8 px-3 text-sm rounded-lg',
  md: 'min-h-10 px-4 text-sm rounded-xl',
  lg: 'min-h-11 px-5 text-base rounded-xl',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant = 'primary',
    size = 'md',
    loading = false,
    disabled,
    asChild = false,
    children,
    type = 'button',
    ...props
  },
  ref,
) {
  const Comp = asChild ? Slot : 'button';
  const isLink = variant === 'link';

  return (
    <Comp
      ref={ref}
      type={asChild ? undefined : type}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
        'disabled:pointer-events-none disabled:cursor-not-allowed',
        !isLink && sizeClasses[size],
        variantClasses[variant],
        className,
      )}
      {...props}
    >
      {loading ? (
        <span
          className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden
        />
      ) : null}
      {children}
    </Comp>
  );
});
