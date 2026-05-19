'use client';

import { type ReactNode } from 'react';
import { BOOKING_START_PRIMARY_BUTTON_CLASSES } from '@/lib/table-management/booking-status-visual';

export function CompactInfo({
  label,
  value,
  valueClass,
  dense = false,
}: {
  label: string;
  value: ReactNode;
  valueClass?: string;
  dense?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className={`${dense ? 'text-[9px]' : 'text-[10px]'} font-semibold uppercase tracking-wider text-slate-400`}>{label}</p>
      <p className={[dense ? 'truncate text-xs font-medium text-slate-800' : 'mt-0.5 truncate text-sm font-medium text-slate-800', valueClass].filter(Boolean).join(' ')}>{value}</p>
    </div>
  );
}

export function DepositRefundBanner({
  depositStatus,
  depositAmount,
  cancellationDeadline,
}: {
  depositStatus: string;
  depositAmount: string;
  cancellationDeadline: string | null;
}) {
  if (depositStatus === 'Refunded') {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
        <div className="flex items-center gap-2">
          <svg className="h-4 w-4 text-emerald-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>
          <p className="text-sm font-medium text-emerald-800">Deposit refunded</p>
        </div>
        <p className="mt-1 text-xs text-emerald-700">{depositAmount} has been refunded to the customer&apos;s payment method. Allow 5–10 business days for processing.</p>
      </div>
    );
  }

  if (depositStatus === 'Paid') {
    const wasEligible = cancellationDeadline && new Date() <= new Date(cancellationDeadline);
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
        <div className="flex items-center gap-2">
          <svg className="h-4 w-4 text-amber-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126Z" /></svg>
          <p className="text-sm font-medium text-amber-800">Deposit not refunded</p>
        </div>
        <p className="mt-1 text-xs text-amber-700">
          {wasEligible
            ? `${depositAmount} - refund was eligible but failed to process. Please refund manually via Stripe.`
            : `${depositAmount} - cancelled after the 48-hour refund window. Deposit retained per cancellation policy.`}
        </p>
      </div>
    );
  }

  return null;
}

export function ActionButton({
  onClick,
  disabled,
  variant,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  variant: 'primary' | 'primary-start' | 'danger' | 'outline-danger' | 'secondary';
  children: React.ReactNode;
}) {
  const styles = {
    primary: 'bg-brand-600 text-white hover:bg-brand-700',
    'primary-start': BOOKING_START_PRIMARY_BUTTON_CLASSES,
    danger: 'bg-red-600 text-white hover:bg-red-700',
    'outline-danger': 'border border-red-200 text-red-600 hover:bg-red-50',
    secondary: 'border border-slate-300 text-slate-700 hover:bg-slate-100',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold disabled:opacity-50 ${styles[variant]}`}
    >
      {children}
    </button>
  );
}
