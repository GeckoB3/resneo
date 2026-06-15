import Link from 'next/link';
import type { HelpArticle } from '@/lib/help/types';
import { helpArticleHref } from '@/lib/help/navigation';

const SECTION_ORDER = ['gs-start-here', 'gs-know-the-app', 'gs-configure-venue', 'gs-open-the-doors'] as const;

const SECTION_META: Record<(typeof SECTION_ORDER)[number], { title: string; subtitle: string }> = {
  'gs-start-here': {
    title: 'Start here',
    subtitle: 'What ResNeo is, how it fits your day, and where to go first.',
  },
  'gs-know-the-app': {
    title: 'Know the app',
    subtitle: 'Home, sidebar, roles, and how the dashboard adapts to your venue.',
  },
  'gs-configure-venue': {
    title: 'Configure your venue',
    subtitle: 'Profile, identity on the web, and payments—before guests arrive.',
  },
  'gs-open-the-doors': {
    title: 'Open the doors',
    subtitle: 'Share your booking link, embed on your site, and use the setup checklist to go live.',
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
