import Link from 'next/link';
import { PageHeader } from '@/components/ui/dashboard/PageHeader';

/**
 * Unified entry point for guest class commerce areas (credits, courses, memberships, recurring, saved cards).
 */
export default function AccountClassesHubPage() {
  const links: Array<{ href: string; label: string; description: string }> = [
    {
      href: '/account/bookings',
      label: 'Bookings',
      description: 'Upcoming and past reservations, including multi-session groups.',
    },
    {
      href: '/account/credits',
      label: 'Class credits',
      description: 'Balances and buying packs from venues you visit.',
    },
    {
      href: '/account/courses',
      label: 'Courses',
      description: 'Enrollments in multi-session course products.',
    },
    {
      href: '/account/memberships',
      label: 'Memberships',
      description: 'Subscriptions billed on each venue’s Stripe account.',
    },
    {
      href: '/account/recurring',
      label: 'Recurring rules',
      description: 'Standing reservations processed by the venue schedule.',
    },
    {
      href: '/account/payment-methods',
      label: 'Saved cards',
      description: 'Cards on file per venue (Connect customer).',
    },
  ];

  const rowClass =
    'group flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-slate-50/80 sm:px-6';

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Account"
        title="Classes & packs"
        subtitle="Everything for class bookings, packs, courses, memberships, and venue-specific saved payment methods."
      />
      <ul className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm shadow-slate-900/5">
        {links.map((l) => (
          <li key={l.href} className="border-b border-slate-100 last:border-b-0">
            <Link href={l.href} className={rowClass}>
              <div className="min-w-0">
                <p className="font-semibold text-slate-900 group-hover:text-brand-800">{l.label}</p>
                <p className="mt-1 text-sm leading-relaxed text-slate-600">{l.description}</p>
              </div>
              <svg
                className="h-5 w-5 shrink-0 text-slate-300 transition-colors group-hover:text-brand-500"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
                aria-hidden
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
              </svg>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
