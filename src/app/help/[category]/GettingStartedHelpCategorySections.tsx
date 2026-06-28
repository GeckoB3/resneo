import Link from 'next/link';
import type { HelpArticle } from '@/lib/help/types';
import { helpArticleHref } from '@/lib/help/navigation';

const SECTION_ORDER = ['gs-start-here', 'gs-set-up', 'gs-catalogue', 'gs-run', 'gs-grow'] as const;

const SECTION_META: Record<(typeof SECTION_ORDER)[number], { title: string; subtitle: string }> = {
  'gs-start-here': {
    title: 'Start here',
    subtitle: 'What ResNeo is, your dashboard, and the quickest path to your first booking.',
  },
  'gs-set-up': {
    title: 'Set up your venue',
    subtitle: 'Your profile, hours, payments, booking page, and team, before guests arrive.',
  },
  'gs-catalogue': {
    title: 'Build what you sell',
    subtitle: 'Services, classes, events, and bookable resources.',
  },
  'gs-run': {
    title: 'Run your day',
    subtitle: 'The calendar, bookings, contacts, waitlist, and compliance you use day to day.',
  },
  'gs-grow': {
    title: 'Communicate and grow',
    subtitle: 'Messaging, reports, importing your data, and refer and earn.',
  },
};

export function GettingStartedHelpCategorySections({ articles }: { articles: HelpArticle[] }) {
  return (
    <div className="mt-10 space-y-12">
      {SECTION_ORDER.map((sectionKey) => {
        const sectionArticles = articles.filter((a) => a.helpSection === sectionKey);
        if (sectionArticles.length === 0) return null;
        const meta = SECTION_META[sectionKey];
        return (
          <section key={sectionKey} aria-labelledby={`help-gs-section-${sectionKey}`}>
            <div className="mb-4 border-b border-slate-200/90 pb-3">
              <h2 id={`help-gs-section-${sectionKey}`} className="text-xl font-bold text-slate-900">
                {meta.title}
              </h2>
              <p className="mt-1 text-sm text-slate-600">{meta.subtitle}</p>
            </div>
            <ul className="grid gap-3 sm:grid-cols-2">
              {sectionArticles.map((art) => (
                <li key={art.slug}>
                  <Link
                    href={helpArticleHref('getting-started', art.slug)}
                    className="group flex h-full flex-col rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm transition-all hover:border-brand-300 hover:shadow-md hover:shadow-brand-900/5"
                  >
                    <span className="font-semibold text-slate-900 group-hover:text-brand-800">{art.title}</span>
                    <p className="mt-1 flex-1 text-sm leading-relaxed text-slate-600">{art.description}</p>
                    <span className="mt-3 text-xs font-semibold uppercase tracking-wide text-brand-700">Read article</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
