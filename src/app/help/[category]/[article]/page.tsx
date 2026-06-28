import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { AppointmentsHelpArticleBody } from '@/components/help/AppointmentsHelpArticleBody';
import { GettingStartedHelpArticleBody } from '@/components/help/GettingStartedHelpArticleBody';
import { HelpArticleContent } from '@/components/help/HelpArticleContent';
import { HelpBreadcrumb } from '@/components/help/HelpBreadcrumb';
import { isHelpCategorySlugVisible } from '@/lib/help/filter-help-for-audience';
import { getCachedHelpAudienceContext } from '@/lib/help/help-audience-context';
import { getAdjacentArticles, getArticle, getCategoryBySlug, getAllHelpPaths } from '@/lib/help/navigation';
import { resolveArticleMarkdown } from '@/lib/help/resolve-article-markdown';
export function generateStaticParams() {
  return getAllHelpPaths().map(({ category, article }) => ({ category, article }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string; article: string }>;
}): Promise<Metadata> {
  const { category: categorySlug, article: articleSlug } = await params;
  const cat = getCategoryBySlug(categorySlug);
  const art = getArticle(categorySlug, articleSlug);
  return {
    title: art && cat ? `${art.title} | ${cat.title} | Help` : 'Help',
    description: art?.description,
  };
}

export default async function HelpArticlePage({ params }: { params: Promise<{ category: string; article: string }> }) {
  const { category: categorySlug, article: articleSlug } = await params;
  const cat = getCategoryBySlug(categorySlug);
  const art = getArticle(categorySlug, articleSlug);
  if (!cat || !art) notFound();

  const audienceContext = await getCachedHelpAudienceContext();
  if (!isHelpCategorySlugVisible(audienceContext, categorySlug)) {
    notFound();
  }

  const articleMarkdown = resolveArticleMarkdown(art, audienceContext);

  const { prev, next } = getAdjacentArticles(categorySlug, articleSlug);
  const isAppointments = categorySlug === 'appointments';
  const isGettingStarted = categorySlug === 'getting-started';
  const wideArticle = isAppointments || isGettingStarted;

  return (
    <article
      className={`${isGettingStarted ? 'getting-started-help-article ' : ''}mx-auto ${wideArticle ? 'max-w-4xl' : 'max-w-3xl'}`}
    >
      <HelpBreadcrumb categoryTitle={cat.title} categorySlug={cat.slug} articleTitle={art.title} />
      <h1 className="text-3xl font-bold text-slate-900">{art.title}</h1>
      <p className="mt-2 text-lg text-slate-600">{art.description}</p>

      <div
        className={
          isGettingStarted
            ? 'mt-8 rounded-2xl border border-slate-200/90 bg-gradient-to-b from-white via-white to-emerald-50/25 p-6 shadow-md shadow-slate-900/5 ring-1 ring-slate-100 sm:p-8'
            : 'mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8'
        }
      >
        {isAppointments ? (
          <AppointmentsHelpArticleBody markdown={articleMarkdown} />
        ) : isGettingStarted ? (
          <GettingStartedHelpArticleBody markdown={articleMarkdown} />
        ) : (
          <HelpArticleContent markdown={articleMarkdown} />
        )}
      </div>

      <nav className="mt-10 flex flex-col gap-3 border-t border-slate-200 pt-8 sm:flex-row sm:justify-between" aria-label="Article pagination">
        {prev ? (
          <Link
            href={prev.href}
            className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm transition-colors hover:border-brand-200"
          >
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Previous</span>
            <p className="font-semibold text-brand-800">{prev.title}</p>
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link
            href={next.href}
            className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-right text-sm shadow-sm transition-colors hover:border-brand-200 sm:ml-auto"
          >
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Next</span>
            <p className="font-semibold text-brand-800">{next.title}</p>
          </Link>
        ) : null}
      </nav>
    </article>
  );
}
