'use client';

/** Shared presentational pieces for the Linked Accounts settings tab. */

import { type ReactNode } from 'react';
import { Dialog } from '@/components/ui/primitives/Dialog';
import type { PillVariant } from '@/components/ui/dashboard/Pill';
import {
  applyCalendarVisibilityChange,
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

export const linkedNewBookingButtonClass =
  'inline-flex items-center justify-center rounded-lg bg-brand-600 px-2.5 py-1 text-[10px] font-semibold text-white shadow-sm shadow-brand-900/20 transition hover:bg-brand-700 sm:text-xs';

/**
 * Linked Accounts dialog (§19.2/§19.4). A thin wrapper over the app's Radix
 * `Dialog` primitive, which provides a focus trap, focus restoration, body
 * scroll lock, a visible close control, portal rendering and full ARIA. The
 * `maxWidth` (a Tailwind `max-w-*` class) overrides the primitive's size. When
 * `busy`, dismissal (Escape / overlay / close) is suppressed so an in-flight
 * action can't be interrupted.
 */
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
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
      title={title}
      description={description}
      contentClassName={maxWidth}
    >
      {children}
    </Dialog>
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

/** A §18 "which of your calendars?" picker — All vs a specific subset. */
function CalendarScopeField({
  calendars,
  value,
  disabled,
  onChange,
}: {
  calendars: { id: string; name: string }[];
  value: string[] | null;
  disabled?: boolean;
  onChange: (ids: string[] | null) => void;
}) {
  const specific = value != null && value.length > 0;
  const selected = new Set(value ?? []);
  return (
    <div className="block">
      <span className="block text-xs font-medium text-slate-700">Which of your calendars?</span>
      <div className="mt-1 flex gap-4 text-xs text-slate-700">
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            className="border-slate-300"
            disabled={disabled}
            checked={!specific}
            onChange={() => onChange(null)}
          />
          All calendars
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            className="border-slate-300"
            disabled={disabled}
            checked={specific}
            onChange={() => onChange(calendars.map((c) => c.id))}
          />
          Choose specific
        </label>
      </div>
      {specific ? (
        <div className="mt-2 max-h-36 space-y-1 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2">
          {calendars.map((c) => (
            <label key={c.id} className="flex items-center gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                className="rounded border-slate-300"
                disabled={disabled}
                checked={selected.has(c.id)}
                onChange={(e) => {
                  const next = new Set(selected);
                  if (e.target.checked) next.add(c.id);
                  else next.delete(c.id);
                  onChange(next.size === 0 ? null : [...next]);
                }}
              />
              {c.name}
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Editor for one direction of a link's permissions, with §5.5 coherence. */
export function GrantEditor({
  label,
  hint,
  value,
  onChange,
  disabled = false,
  calendars,
}: {
  label: string;
  hint?: string;
  value: LinkGrant;
  onChange: (next: LinkGrant) => void;
  disabled?: boolean;
  /** §18 — the granting venue's own calendars, enabling the scope picker. */
  calendars?: { id: string; name: string }[];
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
                applyCalendarVisibilityChange(
                  v,
                  e.target.value as LinkCalendarVisibility,
                ),
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

        {calendars && calendars.length > 0 && v.calendar !== 'none' ? (
          <CalendarScopeField
            calendars={calendars}
            value={v.calendarIds ?? null}
            disabled={disabled}
            onChange={(ids) => onChange(normaliseGrant({ ...v, calendarIds: ids }))}
          />
        ) : null}
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
  myCalendars,
}: {
  otherVenueName: string;
  mine: LinkGrant;
  theirs: LinkGrant;
  onChangeMine: (g: LinkGrant) => void;
  onChangeTheirs: (g: LinkGrant) => void;
  disabled?: boolean;
  /** §18 — your own calendars; only the "mine" direction can be scoped. */
  myCalendars?: { id: string; name: string }[];
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
        calendars={myCalendars}
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
