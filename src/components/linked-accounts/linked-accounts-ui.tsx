'use client';

/** Shared presentational pieces for the Linked Accounts settings tab. */

import { useEffect, useId, type ReactNode } from 'react';
import type { PillVariant } from '@/components/ui/dashboard/Pill';
import {
  describeGrant,
  isLinkConfigurationValid,
  normaliseGrant,
  summariseGrant,
} from '@/lib/linked-accounts/permissions';
import type {
  LinkActionLevel,
  LinkCalendarVisibility,
  LinkGrant,
  LinkStatus,
} from '@/lib/linked-accounts/types';

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  busy = false,
  maxWidth = 'max-w-lg',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  busy?: boolean;
  maxWidth?: string;
}) {
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, busy]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4" role="presentation">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/45"
        aria-label="Close dialog"
        disabled={busy}
        onClick={() => !busy && onClose()}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`relative z-[121] w-full ${maxWidth} max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="text-lg font-bold tracking-tight text-slate-900">
          {title}
        </h2>
        {description ? <p className="mt-1 text-sm text-slate-600">{description}</p> : null}
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

export function statusPill(status: LinkStatus): { label: string; variant: PillVariant } {
  switch (status) {
    case 'accepted':
      return { label: 'Active', variant: 'success' };
    case 'pending':
      return { label: 'Pending', variant: 'warning' };
    case 'suspended':
      return { label: 'Suspended', variant: 'warning' };
    case 'rejected':
      return { label: 'Declined', variant: 'neutral' };
    case 'revoked':
      return { label: 'Unlinked', variant: 'neutral' };
    case 'expired':
      return { label: 'Expired', variant: 'neutral' };
    default:
      return { label: status, variant: 'neutral' };
  }
}

const SELECT_CLS =
  'w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:bg-slate-50 disabled:text-slate-400';

/** Editor for one direction of a link's permissions, with §5.5 coherence. */
export function GrantEditor({
  label,
  hint,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  hint?: string;
  value: LinkGrant;
  onChange: (next: LinkGrant) => void;
  disabled?: boolean;
}) {
  const v = normaliseGrant(value);
  const calendarDisabled = disabled;
  const piiDisabled = disabled || v.calendar !== 'full_details';
  const actDisabled = disabled || v.calendar !== 'full_details' || !v.pii;

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
      <p className="text-sm font-semibold text-slate-900">{label}</p>
      {hint ? <p className="mt-0.5 text-xs text-slate-500">{hint}</p> : null}
      <div className="mt-3 space-y-3">
        <label className="block">
          <span className="block text-xs font-medium text-slate-700">Calendar visibility</span>
          <select
            className={`mt-1 ${SELECT_CLS}`}
            value={v.calendar}
            disabled={calendarDisabled}
            onChange={(e) =>
              onChange(
                normaliseGrant({
                  ...v,
                  calendar: e.target.value as LinkCalendarVisibility,
                }),
              )
            }
          >
            <option value="none">No access</option>
            <option value="time_only">Busy/free time blocks only</option>
            <option value="full_details">Full booking detail</option>
          </select>
        </label>

        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            className="mt-0.5 rounded border-slate-300"
            checked={v.pii}
            disabled={piiDisabled}
            onChange={(e) => onChange(normaliseGrant({ ...v, pii: e.target.checked }))}
          />
          <span className="text-xs text-slate-700">
            Share client contact details (name, email, phone)
          </span>
        </label>

        <label className="block">
          <span className="block text-xs font-medium text-slate-700">Booking actions</span>
          <select
            className={`mt-1 ${SELECT_CLS}`}
            value={v.act}
            disabled={actDisabled}
            onChange={(e) =>
              onChange(normaliseGrant({ ...v, act: e.target.value as LinkActionLevel }))
            }
          >
            <option value="none">Read-only</option>
            <option value="edit_existing">Edit existing bookings</option>
            <option value="create_edit_cancel">Create, edit and cancel bookings</option>
          </select>
        </label>
      </div>
    </div>
  );
}

/** Editor for both directions of a link, with the zero-way validity check. */
export function GrantPairEditor({
  otherVenueName,
  mine,
  theirs,
  onChangeMine,
  onChangeTheirs,
  disabled = false,
}: {
  otherVenueName: string;
  mine: LinkGrant;
  theirs: LinkGrant;
  onChangeMine: (g: LinkGrant) => void;
  onChangeTheirs: (g: LinkGrant) => void;
  disabled?: boolean;
}) {
  const valid = isLinkConfigurationValid(normaliseGrant(mine), normaliseGrant(theirs));
  return (
    <div className="space-y-3">
      <GrantEditor
        label={`What ${otherVenueName} can do with your data`}
        hint="This is the access your venue grants."
        value={mine}
        onChange={onChangeMine}
        disabled={disabled}
      />
      <GrantEditor
        label={`What you can do with ${otherVenueName}'s data`}
        hint="This is the access you are asking the other venue to grant."
        value={theirs}
        onChange={onChangeTheirs}
        disabled={disabled}
      />
      {!valid ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
          A link must grant access in at least one direction.
        </p>
      ) : null}
    </div>
  );
}

/** Two-column "you can / they can" summary for an active link. */
export function GrantSummary({
  iCan,
  theyCan,
  otherVenueName,
}: {
  iCan: LinkGrant;
  theyCan: LinkGrant;
  otherVenueName: string;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-xl border border-slate-200 bg-white p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">You can</p>
        <p className="mt-1 text-sm font-medium text-slate-900">{summariseGrant(iCan)}</p>
        <ul className="mt-1.5 space-y-0.5 text-xs text-slate-600">
          {describeGrant(iCan).map((d) => (
            <li key={d}>· {d}</li>
          ))}
        </ul>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {otherVenueName} can
        </p>
        <p className="mt-1 text-sm font-medium text-slate-900">{summariseGrant(theyCan)}</p>
        <ul className="mt-1.5 space-y-0.5 text-xs text-slate-600">
          {describeGrant(theyCan).map((d) => (
            <li key={d}>· {d}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export const btnPrimary =
  'inline-flex items-center justify-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50';
export const btnSecondary =
  'inline-flex items-center justify-center rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50';
export const btnDanger =
  'inline-flex items-center justify-center rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-50';
