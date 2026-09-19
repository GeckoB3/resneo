'use client';

import { useMemo, useState } from 'react';
import {
  AUDIENCE_SEGMENT_LABELS,
  type AudienceSegment,
  type AudienceVenue,
} from '@/lib/platform/broadcast-audience';
import { SEGMENT_PILL } from './contact-users-shared';

interface Props {
  venues: AudienceVenue[] | null;
  loading: boolean;
  error: string | null;
  mode: 'all' | 'selected';
  selectedIds: string[];
  important: boolean;
  onModeChange: (mode: 'all' | 'selected') => void;
  onSelectedChange: (ids: string[]) => void;
  onRetry: () => void;
}

const SEGMENT_ORDER: AudienceSegment[] = ['paying', 'trial', 'cancelling', 'past_due', 'complimentary', 'test'];

export function RecipientPicker({
  venues,
  loading,
  error,
  mode,
  selectedIds,
  important,
  onModeChange,
  onSelectedChange,
  onRetry,
}: Props) {
  const [search, setSearch] = useState('');
  const [segments, setSegments] = useState<Set<AudienceSegment>>(new Set());
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  const all = useMemo(() => venues ?? [], [venues]);
  const live = useMemo(() => all.filter((v) => v.segment !== 'test'), [all]);

  const segmentCounts = useMemo(() => {
    const m = new Map<AudienceSegment, number>();
    for (const v of all) m.set(v.segment, (m.get(v.segment) ?? 0) + 1);
    return m;
  }, [all]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter((v) => {
      if (segments.size > 0 && !segments.has(v.segment)) return false;
      if (!q) return true;
      return (
        v.name.toLowerCase().includes(q) ||
        (v.slug ?? '').toLowerCase().includes(q) ||
        v.contacts.some((c) => c.email.includes(q) || (c.name ?? '').toLowerCase().includes(q))
      );
    });
  }, [all, search, segments]);

  function toggleSegment(s: AudienceSegment) {
    setSegments((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }

  function toggleVenue(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectedChange([...next]);
  }

  function selectShown() {
    const next = new Set(selected);
    for (const v of shown) next.add(v.id);
    onSelectedChange([...next]);
  }

  function clearShown() {
    const next = new Set(selected);
    for (const v of shown) next.delete(v.id);
    onSelectedChange([...next]);
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <ModeCard
          active={mode === 'all'}
          onClick={() => onModeChange('all')}
          title="All current subscribers"
          detail={
            loading
              ? 'Loading venues...'
              : `${live.length} ${live.length === 1 ? 'venue' : 'venues'}: paying, on trial, cancelling, overdue and complimentary. Test venues are left out.`
          }
        />
        <ModeCard
          active={mode === 'selected'}
          onClick={() => onModeChange('selected')}
          title="Choose venues"
          detail={
            selectedIds.length > 0
              ? `${selectedIds.length} ${selectedIds.length === 1 ? 'venue' : 'venues'} chosen`
              : 'Pick exactly who gets this email.'
          }
        />
      </div>

      {error ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <span>{error}</span>
          <button type="button" onClick={onRetry} className="font-semibold underline">
            Try again
          </button>
        </div>
      ) : null}

      {mode === 'selected' ? (
        <div className="rounded-xl border border-slate-200">
          <div className="space-y-3 border-b border-slate-100 p-3">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by venue, owner name or email"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
            <div className="flex flex-wrap gap-1.5">
              {SEGMENT_ORDER.filter((s) => (segmentCounts.get(s) ?? 0) > 0).map((s) => {
                const on = segments.has(s);
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggleSegment(s)}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset transition ${
                      on ? SEGMENT_PILL[s] : 'bg-white text-slate-500 ring-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {AUDIENCE_SEGMENT_LABELS[s]} <span className="opacity-70">{segmentCounts.get(s)}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="text-slate-500">
                Showing {shown.length} of {all.length}
              </span>
              <div className="flex gap-3">
                <button type="button" onClick={selectShown} className="font-semibold text-blue-600 hover:underline">
                  Select all shown
                </button>
                <button type="button" onClick={clearShown} className="font-semibold text-slate-500 hover:underline">
                  Clear shown
                </button>
              </div>
            </div>
          </div>

          <ul className="max-h-[360px] divide-y divide-slate-100 overflow-y-auto">
            {loading && all.length === 0 ? (
              <li className="px-4 py-6 text-center text-sm text-slate-400">Loading venues...</li>
            ) : shown.length === 0 ? (
              <li className="px-4 py-6 text-center text-sm text-slate-400">No venues match.</li>
            ) : (
              shown.map((v) => {
                const checked = selected.has(v.id);
                const reachable = v.contacts.filter((c) => important || !c.optedOut);
                return (
                  <li key={v.id}>
                    <label
                      className={`flex cursor-pointer items-start gap-3 px-4 py-2.5 hover:bg-slate-50 ${checked ? 'bg-blue-50/40' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleVenue(v.id)}
                        className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-slate-900">{v.name}</span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${SEGMENT_PILL[v.segment]}`}
                          >
                            {AUDIENCE_SEGMENT_LABELS[v.segment]}
                          </span>
                          <span className="text-[11px] text-slate-400">{v.planLabel}</span>
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-slate-500">
                          {v.contacts.length === 0 ? (
                            <span className="text-rose-600">No email address on file</span>
                          ) : (
                            v.contacts.map((c, i) => (
                              <span key={c.email} className={c.optedOut && !important ? 'text-slate-400 line-through' : ''}>
                                {i > 0 ? ', ' : ''}
                                {c.email}
                              </span>
                            ))
                          )}
                          {v.contactSource === 'business_email' ? (
                            <span className="ml-1 text-amber-700">(business email: no admin login found)</span>
                          ) : null}
                          {v.contacts.length > 0 && reachable.length === 0 ? (
                            <span className="ml-1 text-slate-500">(unsubscribed)</span>
                          ) : null}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function ModeCard({
  active,
  onClick,
  title,
  detail,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  detail: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-start gap-3 rounded-xl border p-4 text-left transition ${
        active ? 'border-blue-500 bg-blue-50/60 ring-2 ring-blue-100' : 'border-slate-200 bg-white hover:border-slate-300'
      }`}
    >
      <span
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${
          active ? 'border-blue-600' : 'border-slate-300'
        }`}
      >
        {active ? <span className="h-2 w-2 rounded-full bg-blue-600" /> : null}
      </span>
      <span>
        <span className="block text-sm font-semibold text-slate-900">{title}</span>
        <span className="mt-0.5 block text-xs leading-5 text-slate-500">{detail}</span>
      </span>
    </button>
  );
}
