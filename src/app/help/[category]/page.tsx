import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { AppointmentsHelpCategorySections } from '@/app/help/[category]/AppointmentsHelpCategorySections';
import { GettingStartedHelpCategorySections } from '@/app/help/[category]/GettingStartedHelpCategorySections';
import { HelpBreadcrumb } from '@/components/help/HelpBreadcrumb';
import { isHelpCategorySlugVisible } from '@/lib/help/filter-help-for-audience';
import { getCachedHelpAudienceContext } from '@/lib/help/help-audience-context';
import { getCategoryBySlug, helpArticleHref, HELP_CATEGORIES } from '@/lib/help/navigation';

export function generateStaticParams() {
  return HELP_CATEGORIES.map((c) => ({ category: c.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string }>;
}): Promise<Metadata> {
  const { category } = await params;
  const cat = getCategoryBySlug(category);
  return {
    title: cat ? `${cat.title} | Help` : 'Help',
    description: cat?.description,
  };
}

export default async function HelpCategoryPage({ params }: { params: Promise<{ category: string }> }) {
  const { category: categorySlug } = await params;
  const cat = getCategoryBySlug(categorySlug);
  if (!cat) notFound();

  const audienceContext = await getCachedHelpAudienceContext();
  if (!isHelpCategorySlugVisible(audienceContext, categorySlug)) {
    notFound();
  }

  const isAppointments = categorySlug === 'appointments';
  const isGettingStarted = categorySlug === 'getting-started';
  const appointmentsHeroVariant =
    audienceContext.mode === 'venue' && audienceContext.hybridScheduleAddOns ? 'schedule-add-ons' : 'appointments-plan';

  if (isAppointments) {
    return (
      <div className="mx-auto max-w-4xl">
        <HelpBreadcrumb categoryTitle={cat.title} categorySlug={cat.slug} />
        <div className="relative mt-2 overflow-hidden rounded-3xl border border-slate-200/80 bg-gradient-to-br from-brand-50 via-white to-slate-50 p-6 shadow-sm sm:p-10">
          <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-brand-200/30 blur-3xl" aria-hidden />
          <div className="relative max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-wider text-brand-800">
              {appointmentsHeroVariant === 'schedule-add-ons'
                ? 'Schedule & add-on booking types'
                : 'Appointments plan help'}
            </p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">{cat.title}</h1>
            <p className="mt-3 text-base leading-relaxed text-slate-700 sm:text-lg">{cat.description}</p>
            <p className="mt-4 text-sm text-slate-600">
              Pick a topic below, or use the search bar above to jump straight to calendars, Stripe, SMS, embeds, and
              more.
            </p>
          </div>
        </div>
        <AppointmentsHelpCategorySections articles={cat.articles} />
      </div>
    );
  }

  if (isGettingStarted) {
    return (
      <div className="mx-auto max-w-4xl">
        <HelpBreadcrumb categoryTitle={cat.title} categorySlug={cat.slug} />
        <div className="relative mt-2 overflow-hidden rounded-3xl border border-emerald-200/60 bg-gradient-to-br from-emerald-50/90 via-white to-sky-50/50 p-6 shadow-sm sm:p-10">
          <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-emerald-200/25 blur-3xl" aria-hidden />
          <div className="pointer-events-none absolute -bottom-16 left-1/3 h-48 w-48 rounded-full bg-sky-200/20 blur-3xl" aria-hidden />
          <div className="relative max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-wider text-emerald-900">New to Resneo</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">{cat.title}</h1>
            <p className="mt-3 text-base leading-relaxed text-slate-700 sm:text-lg">{cat.description}</p>
            <p className="mt-4 text-sm text-slate-600">
              Work through the topics in order, or jump to what you need—the search bar above finds any article in this
              help centre.
            </p>
          </div>
        </div>
        <GettingStartedHelpCategorySections articles={cat.articles} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <HelpBreadcrumb categoryTitle={cat.title} categorySlug={cat.slug} />
      <h1 className="text-3xl font-bold text-slate-900">{cat.title}</h1>
      <p className="mt-2 text-base text-slate-600">{cat.description}</p>

      <ul className="mt-8 space-y-2">
        {cat.articles.map((art) => (
          <li key={art.slug}>
            <Link
              href={helpArticleHref(cat.slug, art.slug)}
              className="block rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm transition-colors hover:border-brand-200 hover:bg-brand-50/30"
            >
              <span className="font-semibold text-slate-900">{art.title}</span>
              <p className="mt-0.5 text-sm text-slate-600">{art.description}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
