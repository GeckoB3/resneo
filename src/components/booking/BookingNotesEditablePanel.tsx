'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

interface EditableFieldProps {
  label: string;
  value: string;
  bookingId: string;
  fieldKey: string;
  placeholder?: string;
  multiline?: boolean;
  compact?: boolean;
  onSaved: () => void;
}

function EditableField({ label, value, bookingId, fieldKey, placeholder, multiline, compact = false, onSaved }: EditableFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const cancel = useCallback(() => {
    setDraft(value);
    setSaveError(null);
    setEditing(false);
  }, [value]);

  const save = useCallback(async () => {
    if (draft === value) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/venue/bookings/${bookingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [fieldKey]: draft.trim() || null }),
      });
      if (res.ok) {
        setEditing(false);
        onSaved();
      } else {
        const j = await res.json().catch(() => ({}));
        setSaveError((j as { error?: string }).error ?? 'Failed to save. Please try again.');
      }
    } catch {
      setSaveError('Network error. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [bookingId, draft, fieldKey, onSaved, value]);

  const hasValue = value.trim().length > 0;
  const isDirty = draft !== value;

  const inputClass = [
    'w-full rounded-lg border bg-white text-slate-800 transition-shadow',
    compact ? 'px-2.5 py-1.5 text-xs' : 'px-3 py-2 text-sm',
    'placeholder:text-slate-400',
    'focus:outline-none focus:ring-2',
    saveError
      ? 'border-red-300 focus:border-red-400 focus:ring-red-100'
      : 'border-slate-300 focus:border-brand-400 focus:ring-brand-100',
  ].join(' ');

  return (
    <div className="group/field">
      <div className={`${compact ? 'mb-1' : 'mb-1.5'} flex items-center justify-between`}>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
        {!editing && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setEditing(true);
            }}
            className="invisible inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 group-hover/field:visible"
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Z" />
            </svg>
            Edit
          </button>
        )}
      </div>

      {editing ? (
        <div>
          {multiline ? (
            <textarea
              ref={inputRef as RefObject<HTMLTextAreaElement>}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setSaveError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') cancel();
              }}
              rows={compact ? 2 : 3}
              className={inputClass}
              placeholder={placeholder}
            />
          ) : (
            <input
              ref={inputRef as RefObject<HTMLInputElement>}
              type="text"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setSaveError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  void save();
                }
                if (e.key === 'Escape') cancel();
              }}
              className={inputClass}
              placeholder={placeholder}
            />
          )}

          {saveError && (
            <p className="mt-1 flex items-center gap-1 text-[11px] text-red-600">
              <svg className="h-3 w-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
              </svg>
              {saveError}
            </p>
          )}

          <div className={`${compact ? 'mt-1.5' : 'mt-2'} flex items-center gap-2`}>
            <button
              type="button"
              onClick={() => {
                void save();
              }}
              disabled={saving || !isDirty}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? (
                <>
                  <svg className="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4Z" />
                  </svg>
                  Saving...
                </>
              ) : (
                <>
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                  </svg>
                  Save
                </>
              )}
            </button>
            <button
              type="button"
              onClick={cancel}
              disabled={saving}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700 disabled:opacity-50"
            >
              Cancel
            </button>
            {isDirty && !saving && <span className="ml-auto text-[10px] text-slate-400">Unsaved changes</span>}
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setEditing(true);
          }}
          title={`Click to ${hasValue ? 'edit' : 'add'} ${label.toLowerCase()}`}
          className={[
            'w-full rounded-lg border text-left transition-colors',
            compact ? 'px-2.5 py-1.5 text-xs' : 'px-3 py-2 text-sm',
            hasValue
              ? 'border-slate-200 bg-white text-slate-700 hover:border-brand-300 hover:bg-brand-50/40'
              : 'border-dashed border-slate-200 bg-slate-50/60 text-slate-400 italic hover:border-brand-300 hover:bg-brand-50/40',
          ].join(' ')}
        >
          {hasValue ? (
            <span className={`whitespace-pre-wrap break-words ${compact ? 'leading-snug' : 'leading-relaxed'}`}>{value}</span>
          ) : (
            <span className="flex items-center gap-2">
              <svg className="h-3.5 w-3.5 text-slate-300" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              {placeholder ?? `Add ${label.toLowerCase()}...`}
            </span>
          )}
        </button>
      )}
    </div>
  );
}

/** `table`: restaurant table bookings (dietary + guest requests + staff). `cde`: appointments, events, classes, resources (booking notes + staff only). */
export type BookingNotesVariant = 'table' | 'cde';

export interface BookingNotesEditablePanelProps {
  bookingId: string;
  dietaryNotes: string | null | undefined;
  guestRequests: string | null | undefined;
  staffNotes: string | null | undefined;
  onSaved: () => void;
  /** When true, values are visible but editing is blocked (e.g. booking detail still loading). */
  disabled?: boolean;
  /** Which note fields to show. `cde` maps guest-facing copy to `special_requests` (booking notes from the guest flow). */
  notesVariant?: BookingNotesVariant;
  /** Slimmer layout for embedding inside another card. */
  compact?: boolean;
  /** Removes the panel frame so parent sections can own the visual grouping. */
  embedded?: boolean;
}

export function BookingNotesEditablePanel({
  bookingId,
  dietaryNotes,
  guestRequests,
  staffNotes,
  onSaved,
  disabled = false,
  notesVariant = 'table',
  compact = false,
  embedded = false,
}: BookingNotesEditablePanelProps) {
  const isCde = notesVariant === 'cde';
  const rootClass = embedded
    ? `space-y-2.5 ${disabled ? 'pointer-events-none opacity-50' : ''}`
    : `rounded-xl border border-slate-200 bg-white p-3.5 ${compact ? 'space-y-2.5' : 'space-y-4'} ${disabled ? 'pointer-events-none opacity-50' : ''}`;

  return (
    <div
      className={rootClass}
      aria-busy={disabled || undefined}
    >
      {!isCde && (
        <>
          <EditableField
            label="Dietary Notes"
            value={dietaryNotes ?? ''}
            bookingId={bookingId}
            fieldKey="dietary_notes"
            placeholder="e.g. Gluten free, nut allergy"
            compact={compact}
            onSaved={onSaved}
          />
          <div className="border-t border-slate-100" />
        </>
      )}
      {isCde && (dietaryNotes?.trim() ?? '') !== '' && (
        <>
          <div className="rounded-lg border border-amber-100 bg-amber-50/60 px-3 py-2 text-xs text-amber-900">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-800/90">Legacy dietary</p>
            <p className="mt-1 whitespace-pre-wrap text-slate-800">{dietaryNotes}</p>
            <p className="mt-1.5 text-[11px] text-amber-800/80">
              Table-style dietary was stored on this booking. Use Booking Notes for guest-facing text on calendar bookings.
            </p>
          </div>
          <div className="border-t border-slate-100" />
        </>
      )}
      <EditableField
        label={isCde ? 'Booking Notes' : 'Guest Requests'}
        value={guestRequests ?? ''}
        bookingId={bookingId}
        fieldKey="special_requests"
        placeholder={
          isCde
            ? 'Notes, comments or requests the guest entered when booking'
            : 'e.g. Accessibility, timing, or seating preferences'
        }
        multiline={isCde}
        compact={compact}
        onSaved={onSaved}
      />
      <div className="border-t border-slate-100" />
      <EditableField
        label="Staff Notes for this booking"
        value={staffNotes ?? ''}
        bookingId={bookingId}
        fieldKey="internal_notes"
        placeholder={isCde ? 'Internal notes (not visible to the guest)' : 'Internal notes (not visible to guest)'}
        multiline
        compact={compact}
        onSaved={onSaved}
      />
    </div>
  );
}
