'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDismissibleLayer } from '@/lib/ui/use-dismissible-layer';

const PILL_PALETTE = [
  'bg-sky-100 text-sky-800 border-sky-200',
  'bg-violet-100 text-violet-800 border-violet-200',
  'bg-amber-100 text-amber-900 border-amber-200',
  'bg-indigo-100 text-indigo-800 border-indigo-200',
];

function pillClass(i: number): string {
  return PILL_PALETTE[i % PILL_PALETTE.length] ?? PILL_PALETTE[0]!;
}

export interface GuestTagEditorProps {
  tags: string[];
  /** Used for analytics / future scoping; tag list is resolved server-side from auth. */
  venueId: string;
  onTagsChange: (next: string[]) => Promise<void>;
  disabled?: boolean;
  /** When the parent already renders a section heading (e.g. Contact detail panel). */
  hideSectionLabel?: boolean;
}

export function GuestTagEditor({
  tags,
  venueId: _venueId,
  onTagsChange,
  disabled,
  hideSectionLabel = false,
}: GuestTagEditorProps) {
  const [input, setInput] = useState('');
  const [venueTags, setVenueTags] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const loadVenueTags = useCallback(async () => {
    try {
      const res = await fetch('/api/venue/guests/tags');
      if (!res.ok) return;
      const data = (await res.json()) as { tags?: string[] };
      setVenueTags(Array.isArray(data.tags) ? data.tags : []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void loadVenueTags();
  }, [loadVenueTags]);

  useDismissibleLayer({
    open,
    refs: [wrapRef],
    onDismiss: () => setOpen(false),
  });

  const trimmedInput = input.trim().toLowerCase();
  const suggestions = useMemo(() => {
    if (!trimmedInput) return venueTags.filter((t) => !tags.includes(t)).slice(0, 12);
    return venueTags
      .filter((t) => t.includes(trimmedInput) && !tags.some((x) => x.toLowerCase() === t.toLowerCase()))
      .slice(0, 12);
  }, [venueTags, trimmedInput, tags]);

  const commitTags = useCallback(
    async (next: string[]) => {
      setError(null);
      setSaving(true);
      try {
        await onTagsChange(next);
        await loadVenueTags();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not save tags');
      } finally {
        setSaving(false);
      }
    },
    [onTagsChange, loadVenueTags],
  );

  const addTag = useCallback(
    async (raw: string) => {
      const t = raw.trim().toLowerCase();
      if (!t || t.length > 30) return;
      if (tags.some((x) => x.toLowerCase() === t)) return;
      if (tags.length >= 20) {
        setError('Maximum 20 tags per guest.');
        return;
      }
      await commitTags([...tags, t]);
      setInput('');
      setOpen(false);
    },
    [tags, commitTags],
  );

  const removeTag = useCallback(
    async (index: number) => {
      const next = tags.filter((_, i) => i !== index);
      await commitTags(next);
    },
    [tags, commitTags],
  );

  return (
    <div ref={wrapRef} className="space-y-1.5">
      {!hideSectionLabel && (
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Tags</p>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((tag, i) => (
          <span
            key={`${tag}-${i}`}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${pillClass(i)}`}
          >
            {tag}
            {!disabled && (
              <button
                type="button"
                disabled={saving}
                onClick={() => void removeTag(i)}
                className="rounded-full p-0.5 hover:bg-black/10"
                aria-label={`Remove ${tag}`}
              >
                ×
              </button>
            )}
          </span>
        ))}
        {!disabled && (
          <div className="relative min-w-[120px] flex-1">
            <input
              type="text"
              value={input}
              disabled={saving}
              onChange={(e) => {
                setInput(e.target.value);
                setOpen(true);
                setError(null);
              }}
              onFocus={() => setOpen(true)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void addTag(input);
                }
                if (e.key === ',') {
                  if (input.trim()) {
                    e.preventDefault();
                    void addTag(input.replace(/,$/, ''));
                  }
                }
                if (e.key === 'Escape') setOpen(false);
              }}
              placeholder="Add a tag…"
              maxLength={32}
              className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-100"
            />
            {open && suggestions.length > 0 && (
              <ul className="absolute left-0 right-0 top-full z-20 mt-0.5 max-h-36 overflow-auto rounded-lg border border-slate-200 bg-white py-1 text-xs shadow-lg">
                {suggestions.map((s) => (
                  <li key={s}>
                    <button
                      type="button"
                      className="w-full px-2 py-1.5 text-left hover:bg-slate-50"
                      onClick={() => void addTag(s)}
                    >
                      {s}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      {error && <p className="text-[11px] text-red-600">{error}</p>}
      {saving && <p className="text-[11px] text-slate-400">Saving…</p>}
    </div>
  );
}
