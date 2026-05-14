'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { HelpAudienceContext } from '@/lib/help/help-audience-context';
import type { HelpCategory, HelpPlanFilter } from '@/lib/help/types';
import { isAppointmentPlanTier, isRestaurantTableProductTier } from '@/lib/tier-enforcement';
import { HelpCategoryCard } from '@/components/help/HelpCategoryCard';

type Filter = 'all' | HelpPlanFilter;

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All topics' },
  { id: 'restaurant', label: 'Restaurant' },
  { id: 'appointments', label: 'Appointments' },
];

function defaultTopicFilter(ctx: HelpAudienceContext): Filter {
  if (ctx.mode === 'anonymous') return 'all';
  if (isRestaurantTableProductTier(ctx.pricingTier)) return 'restaurant';
  if (isAppointmentPlanTier(ctx.pricingTier)) return 'appointments';
  return 'all';
}

function filterVisibleByTopic(visibleCategories: HelpCategory[], filter: Filter): HelpCategory[] {
  if (filter === 'all') return visibleCategories;
  return visibleCategories.filter((c) => c.plan === 'all' || c.plan === filter);
}

export function HelpHomeClient({
  audienceContext,
  visibleCategories,
}: {
  audienceContext: HelpAudienceContext;
  visibleCategories: HelpCategory[];
}) {
  const initial = useMemo(() => defaultTopicFilter(audienceContext), [audienceContext]);
  const [filter, setFilter] = useState<Filter>(initial);

  const visible = useMemo(() => filterVisibleByTopic(visibleCategories, filter), [visibleCategories, filter]);

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">How can we help?</h1>
        <p className="mt-2 max-w-2xl text-base text-slate-600">
          Step-by-step guides for running your venue on ReserveNI: dashboard basics, restaurant tables and dining
          setup, appointment calendars and services, settings, billing, and fixes for common problems.
        </p>
        {audienceContext.mode === 'venue' ? (
          <p className="mt-3 max-w-2xl text-sm text-slate-600">
            Topic cards below follow your venue by default. Use <strong>All topics</strong> to browse every article,
            including ones outside your current plan.
          </p>
        ) : null}
      </div>

      <div className="mb-8 flex flex-wrap gap-2" aria-label="Filter help topics by product">
        {FILTERS.map((f) => {
          const active = filter === f.id;
          return (
            <button
              key={f.id}
              type="button"
              aria-pressed={active}
              onClick={() => setFilter(f.id)}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                active
                  ? 'bg-brand-700 text-white shadow-sm'
                  : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
              }`}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      <p className="mb-4 text-sm text-slate-500">
        {visible.reduce((n, c) => n + c.articles.length, 0)} articles across {visible.length} categories
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        {visible.length === 0 ? (
          <p className="col-span-full rounded-xl border border-slate-200 bg-white px-4 py-6 text-sm text-slate-600">
            No categories match this filter for your venue. Choose <strong>All topics</strong> to see everything that
            still applies (for example shared Settings and Troubleshooting guides).
          </p>
        ) : (
          visible.map((cat) => <HelpCategoryCard key={cat.slug} category={cat} />)
        )}
      </div>

      <div className="mt-12 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Still stuck?</h2>
        <p className="mt-1 text-sm text-slate-600">
          From the dashboard, open <strong>Support</strong> to message the ReserveNI team, or review the{' '}
          <Link href="/help/troubleshooting" className="font-semibold text-brand-700 hover:underline">
            Troubleshooting
          </Link>{' '}
          section.
        </p>
      </div>
    </div>
  );
}
