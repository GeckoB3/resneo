'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Staff-only notes stored on the guest row — shown on every booking for this customer.
 */
export function CustomerProfileNotesCard({
  guestId,
  value,
  disabled,
  onSaved,
  /** When true, nest inside the guest contact card (top border, no separate panel frame). */
  embedded = false,
  /** When true with `embedded`, omit the top rule — use when the parent block already separated this section. */
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

  useEffect(() => {
    if (!editing) setDraft(value ?? '');
  }, [value, editing]);

  const normalized = value ?? '';
  const canEdit = !disabled;

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
      : 'mt-3 border-t border-slate-100 pt-3'
    : 'rounded-xl border border-sky-200 bg-sky-50/80 p-3';

  return (
    <div className={rootClass}>
      <div className={`mb-1.5 flex items-start justify-between gap-2 ${embedded ? 'px-0.5' : ''}`}>
        <p className="pr-2 text-[11px] font-semibold leading-snug text-sky-800">Customer info - only visible to staff.</p>
        {canEdit && !editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="shrink-0 rounded-md px-2 py-1 text-[10px] font-medium text-sky-800 hover:bg-sky-100"
          >
            Edit
          </button>
        )}
      </div>

      {saveError && <p className="mb-2 text-[11px] text-red-700">{saveError}</p>}

      {editing && canEdit ? (
        <div className={`space-y-2 ${embedded ? 'px-0.5' : ''}`}>
          <textarea
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setSaveError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setDraft(value ?? '');
                setEditing(false);
                setSaveError(null);
              }
            }}
            rows={4}
            disabled={saving}
            placeholder="Allergies, accessibility, VIP preferences, payment notes…"
            className="w-full rounded-lg border border-sky-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-200"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => void save()}
              className="rounded-lg bg-sky-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-800 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setDraft(value ?? '');
                setEditing(false);
                setSaveError(null);
              }}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <p className={`whitespace-pre-wrap text-sm text-slate-800 ${embedded ? 'px-0.5' : ''}`}>
          {normalized.trim() ? normalized : '—'}
        </p>
      )}
    </div>
  );
}
