'use client';

import { useState } from 'react';
import { Dialog } from '@/components/ui/primitives/Dialog';
import { MAX_GUEST_TAG_LENGTH } from '@/lib/guests/tags';

export interface AddTagModalProps {
  onClose: () => void;
  recipientCount: number;
  busy: boolean;
  onSubmit: (tag: string) => void;
  /** Existing venue tags, surfaced as one-click chips. */
  existingTags?: string[];
  /** Singular noun for the recipients, e.g. "guest" or "contact". */
  recipientNoun?: string;
}

/**
 * Modal for creating/applying a tag to a set of contacts. Replaces a native
 * `window.prompt`, which throws "prompt() is not supported" in sandboxed
 * contexts. Mount only when shown so input state resets without effects.
 */
export function AddTagModal({
  onClose,
  recipientCount,
  busy,
  onSubmit,
  existingTags = [],
  recipientNoun = 'guest',
}: AddTagModalProps) {
  const [tag, setTag] = useState('');
  const trimmed = tag.trim();
  const submit = (value: string) => {
    const v = value.trim();
    if (!v || busy) return;
    onSubmit(v);
  };
  const suggestions = existingTags
    .filter((t) => t.toLowerCase() !== trimmed.toLowerCase())
    .slice(0, 12);

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o && !busy) onClose();
      }}
      size="md"
      title={`Add tag to ${recipientCount} ${recipientNoun}${recipientCount !== 1 ? 's' : ''}`}
      description="Type a new tag or pick an existing one. Tags are saved on the contact and can be used to filter and segment."
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="min-h-[44px] rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || trimmed.length === 0}
            onClick={() => submit(tag)}
            className="min-h-[44px] rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {busy ? 'Adding…' : 'Add tag'}
          </button>
        </div>
      }
    >
      <label htmlFor="add-tag-input" className="block text-xs font-medium text-slate-600">
        Tag
      </label>
      <input
        id="add-tag-input"
        type="text"
        value={tag}
        maxLength={MAX_GUEST_TAG_LENGTH}
        onChange={(e) => setTag(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit(tag);
          }
        }}
        disabled={busy}
        placeholder="e.g. VIP, regular, allergy"
        className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 disabled:opacity-50"
        autoFocus
      />
      {suggestions.length > 0 ? (
        <div className="mt-3">
          <p className="text-xs font-medium text-slate-500">Existing tags</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {suggestions.map((t) => (
              <button
                key={t}
                type="button"
                disabled={busy}
                onClick={() => submit(t)}
                className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition-colors hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50"
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}
