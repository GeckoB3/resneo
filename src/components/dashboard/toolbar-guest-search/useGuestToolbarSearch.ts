'use client';

import { useEffect, useRef, useState } from 'react';
import type { GuestListRow } from '@/types/contacts';
import { readResponseJson } from '@/lib/http/read-response-json';

const SEARCH_DEBOUNCE_MS = 280;
const MIN_QUERY_LENGTH = 2;
const RESULT_LIMIT = 10;

export function useGuestToolbarSearch(query: string) {
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [results, setResults] = useState<GuestListRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSeq = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (debouncedQuery.length < MIN_QUERY_LENGTH) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }

    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({
      search: debouncedQuery,
      filter: 'all',
      sort: 'name_asc',
      page: '0',
      limit: String(RESULT_LIMIT),
    });

    void (async () => {
      try {
        const res = await fetch(`/api/venue/guests?${params.toString()}`);
        const data = await readResponseJson<{ guests?: GuestListRow[]; error?: string }>(res);
        if (seq !== requestSeq.current) return;
        if (!res.ok) {
          setResults([]);
          setError(typeof data.error === 'string' ? data.error : 'Search failed');
          return;
        }
        setResults(data.guests ?? []);
        setError(null);
      } catch {
        if (seq !== requestSeq.current) return;
        setResults([]);
        setError('Search failed');
      } finally {
        if (seq === requestSeq.current) {
          setLoading(false);
        }
      }
    })();
  }, [debouncedQuery]);

  const showHint = query.trim().length > 0 && query.trim().length < MIN_QUERY_LENGTH;
  const showEmpty =
    debouncedQuery.length >= MIN_QUERY_LENGTH && !loading && !error && results.length === 0;

  return {
    debouncedQuery,
    results,
    loading,
    error,
    showHint,
    showEmpty,
    minQueryLength: MIN_QUERY_LENGTH,
  };
}
