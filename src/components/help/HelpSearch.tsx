'use client';

import Link from 'next/link';
import { useId, useMemo, useRef, useState } from 'react';
import { createHelpSearchFuse, searchHelpArticlesWithFuse } from '@/lib/help/search-index';
import type { HelpSearchDoc } from '@/lib/help/types';
import { useDismissibleLayer } from '@/lib/ui/use-dismissible-layer';

export function HelpSearch({
  className = '',
  searchDocs,
}: {
  className?: string;
  searchDocs: HelpSearchDoc[];
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputId = useId();
  const listboxId = `${inputId}-results`;

  const fuse = useMemo(() => createHelpSearchFuse(searchDocs), [searchDocs]);

  const results = useMemo(() => searchHelpArticlesWithFuse(fuse, query, 8), [fuse, query]);

  const showPanel = open && query.trim().length >= 2;
  useDismissibleLayer({
    open: showPanel,
    refs: [rootRef],
    onDismiss: () => setOpen(false),
  });

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <label htmlFor={inputId} className="sr-only">
        Search help articles
      </label>
      <input
        id={inputId}
        type="search"
        role="combobox"
        aria-expanded={showPanel}
        aria-controls={listboxId}
        aria-autocomplete="list"
        autoComplete="off"
        placeholder="Search help…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 shadow-sm outline-none ring-brand-500/20 placeholder:text-slate-400 focus:border-brand-300 focus:ring-4"
      />
      {showPanel ? (
        <div className="animate-fade-in absolute left-0 right-0 top-full z-50 mt-2 max-h-[min(70vh,24rem)] overflow-auto rounded-xl border border-slate-200 bg-white py-2 shadow-lg">
          {results.length === 0 ? (
            <p className="px-4 py-3 text-sm text-slate-500">No articles match that search.</p>
          ) : (
            <ul id={listboxId} role="listbox" className="divide-y divide-slate-100">
              {results.map((r) => (
                <li key={r.id} role="option" aria-selected={false}>
                  <Link
                    href={r.href}
                    className="block px-4 py-3 transition-colors hover:bg-slate-50"
                    onClick={() => {
                      setOpen(false);
                      setQuery('');
                    }}
                  >
                    <p className="font-semibold text-slate-900">{r.title}</p>
                    <p className="text-xs text-slate-500">{r.categoryTitle}</p>
                    <p className="mt-0.5 line-clamp-2 text-sm text-slate-600">{r.description}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
