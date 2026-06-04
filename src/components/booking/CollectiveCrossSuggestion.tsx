'use client';

import { useEffect, useState } from 'react';
import { readableAccentForWhiteText } from '@/lib/linked-accounts/branding-contrast';

/**
 * §8.6 — when a venue's own booking page has no availability and the venue is a
 * live member of a venue collective, suggest the combined collective page where
 * other practitioners may have slots. Collective-scoped only: a venue with just
 * pairwise links (no collective) gets no suggestion, so this renders nothing.
 *
 * Self-contained: fetches the venue's collective from a public endpoint on mount
 * and renders nothing until/unless one is found, so it adds no chrome otherwise.
 */
export function CollectiveCrossSuggestion({
  venueId,
  accentColour = '#003B6F',
}: {
  venueId: string;
  accentColour?: string;
}) {
  const [collective, setCollective] = useState<{ slug: string; name: string } | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(
          `/api/public/venue-collective?venueId=${encodeURIComponent(venueId)}`,
        );
        if (!res.ok) return;
        const json = (await res.json()) as { collective?: { slug: string; name: string } | null };
        if (alive && json.collective) setCollective(json.collective);
      } catch {
        /* best-effort chrome; stay silent on failure */
      }
    })();
    return () => {
      alive = false;
    };
  }, [venueId]);

  if (!collective) return null;

  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 text-left">
      <p className="text-sm text-slate-700">
        Fully booked here? Other practitioners at{' '}
        <span className="font-semibold text-slate-900">{collective.name}</span> may have
        availability.
      </p>
      <a
        href={`/book/c/${collective.slug}`}
        className="mt-2 inline-flex items-center gap-1 text-sm font-semibold hover:underline"
        // §19.4 — guard the accent for legibility as link text on white (contrast
        // is symmetric, so the white-text guard also fixes accent-on-white).
        style={{ color: readableAccentForWhiteText(accentColour) }}
      >
        Try the {collective.name} page
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4"
        >
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </a>
    </div>
  );
}
