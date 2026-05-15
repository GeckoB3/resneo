'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Customer profile notes stored on the guest row — shown on every booking for this customer.
 */
export function CustomerProfileNotesCard({
  guestId,
  value,
  disabled,
  onSaved,
  /** When true, nest inside the guest contact card (top border, no separate panel frame). */
  embedded = false,
  /** When true with `embedded`, omit the top rule and inner section title — parent already labels this block. */
  embeddedFlush = false,
}: {
  guestId: string | null | undefined;
  value: string | null | undefined;
  disabled?: boolean;
  onSaved: () => void;
  embedded?: boolean;
  embeddedFlush?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing) setDraft(value ?? '');
  }, [value, editing]);

  useEffect(() => {
    if (editing) textareaRef.current?.focus();
  }, [editing]);

  const normalized = value ?? '';
  const canEdit = !disabled;
  const hasValue = normalized.trim().length > 0;
  const isDirty = draft !== normalized;

  const inputClass = [
    'w-full rounded-lg border bg-white text-slate-800 transition-shadow',
    'px-2.5 py-1.5 text-xs',
    'placeholder:text-slate-400',
    'focus:outline-none focus:ring-2',
    saveError
      ? 'border-red-300 focus:border-red-400 focus:ring-red-100'
      : 'border-slate-300 focus:border-brand-400 focus:ring-brand-100',
  ].join(' ');

  const save = useCallback(async () => {
    if (!guestId || guestId === '__prefetch__') return;
    const next = draft.trim();
    const prev = normalized.trim();
    if (next === prev) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/venue/guests/${guestId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_profile_notes: next === '' ? null : draft.trimEnd() }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setSaveError(j.error ?? 'Failed to save');
        return;
      }
      setEditing(false);
      onSaved();
    } catch {
      setSaveError('Network error');
    } finally {
      setSaving(false);
    }
  }, [guestId, draft, normalized, onSaved]);

  if (!guestId || guestId === '__prefetch__') return null;

  if (disabled && !normalized.trim()) {
    return null;
  }

  const rootClass = embedded
    ? embeddedFlush
      ? ''
      : 'mt-2 border-t border-slate-100 pt-2'
    : 'rounded-xl border border-slate-200 bg-white p-3';

  const cancelEditing = () => {
    setDraft(value ?? '');
    setEditing(false);
    setSaveError(null);
  };

  const editButtonClassName =
    'invisible inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 group-hover/field:visible';

  const showFloatingEdit = embeddedFlush && canEdit && !editing;
  const reserveSpaceForFloatingEdit = showFloatingEdit;

  return (
    <div className={rootClass}>
      <div className={`group/field ${embedded ? 'px-0.5' : ''} ${embeddedFlush ? 'relative' : ''}`}>
        {!embeddedFlush ? (
          <div className="mb-1 flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Customer info</p>
            {canEdit && !editing && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditing(true);
                }}
                className={editButtonClassName}
              >
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Z"
                  />
                </svg>
                Edit
              </button>
            )}
          </div>
        ) : (
          showFloatingEdit && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setEditing(true);
              }}
              className={`${editButtonClassName} absolute right-0 top-0 z-10`}
            >
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Z"
                />
              </svg>
              Edit
            </button>
          )
        )}

        {editing && canEdit ? (
          <div>
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setSaveError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') cancelEditing();
              }}
              rows={2}
              disabled={saving}
              placeholder="e.g. Allergies, accessibility, VIP or payment preferences"
              className={inputClass}
            />

            {saveError && (
              <p className="mt-1 flex items-center gap-1 text-[11px] text-red-600">
                <svg className="h-3 w-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"
                  />
                </svg>
                {saveError}
              </p>
            )}

            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={saving || !isDirty}
                onClick={() => void save()}
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
                disabled={saving}
                onClick={cancelEditing}
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
              if (canEdit) setEditing(true);
            }}
            disabled={!canEdit}
            title={`Click to ${hasValue ? 'edit' : 'add'} customer info`}
            className={[
              'w-full rounded-lg border text-left transition-colors',
              'px-2.5 py-1.5 text-xs',
              reserveSpaceForFloatingEdit ? 'pr-14' : '',
              hasValue
                ? 'border-slate-200 bg-white text-slate-700 hover:border-brand-300 hover:bg-brand-50/40'
                : 'border-dashed border-slate-200 bg-slate-50/60 text-slate-400 italic hover:border-brand-300 hover:bg-brand-50/40',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {hasValue ? (
              <span className="whitespace-pre-wrap break-words leading-snug">{normalized}</span>
            ) : (
              <span className="flex items-center gap-2">
                <svg className="h-3.5 w-3.5 text-slate-300" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Add customer info…
              </span>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
