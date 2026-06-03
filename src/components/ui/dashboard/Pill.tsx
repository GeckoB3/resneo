import type { ReactNode } from 'react';

export type PillVariant =
  | 'success'
  | 'neutral'
  | 'warning'
  | 'danger'
  | 'brand'
  | 'info'
  // Compliance record states (spec §11.4)
  | 'compliance-current'
  | 'compliance-expiring'
  | 'compliance-expired'
  | 'compliance-missing'
  | 'compliance-pending'
  | 'compliance-voided';

const variantClasses: Record<PillVariant, string> = {
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  neutral: 'border-slate-200 bg-slate-50 text-slate-700',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  danger: 'border-rose-200 bg-rose-50 text-rose-800',
  brand: 'border-brand-200 bg-brand-50 text-brand-800',
  info: 'border-sky-200 bg-sky-50 text-sky-800',
  'compliance-current': 'border-emerald-200 bg-emerald-50 text-emerald-800',
  'compliance-expiring': 'border-amber-200 bg-amber-50 text-amber-800',
  'compliance-expired': 'border-rose-200 bg-rose-50 text-rose-800',
  'compliance-missing': 'border-slate-200 bg-slate-100 text-slate-600',
  'compliance-pending': 'border-sky-200 bg-sky-50 text-sky-800',
  'compliance-voided': 'border-slate-300 bg-slate-50 text-slate-500',
};

const dotClasses: Record<PillVariant, string> = {
  success: 'bg-emerald-500',
  neutral: 'bg-slate-400',
  warning: 'bg-amber-500',
  danger: 'bg-rose-500',
  brand: 'bg-brand-600',
  info: 'bg-sky-500',
  'compliance-current': 'bg-emerald-500',
  'compliance-expiring': 'bg-amber-500',
  'compliance-expired': 'bg-rose-500',
  'compliance-missing': 'bg-slate-400',
  'compliance-pending': 'bg-sky-500',
  'compliance-voided': 'bg-slate-400',
};

export function Pill({
  children,
  variant = 'neutral',
  size = 'default',
  dot,
  className = '',
}: {
  children: ReactNode;
  variant?: PillVariant;
  size?: 'sm' | 'default';
  dot?: boolean;
  className?: string;
}) {
  const sizeCls = size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-medium ${sizeCls} ${variantClasses[variant]} ${className}`}
    >
      {dot ? <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClasses[variant]}`} /> : null}
      {children}
    </span>
  );
}
