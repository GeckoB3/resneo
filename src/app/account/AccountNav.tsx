'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * P1-3 collapses this to four items. The one change P1-5 had to make first:
 * the five entries that pointed at retired routes are now the single "Passes
 * and plans" item.
 *
 * Not scope creep, a regression it would otherwise have shipped. `linkActive`
 * compares pathnames, so leaving five items aimed at paths that now 307 away
 * meant a customer standing on `/account/passes` saw NO item marked current:
 * the nav would have stopped telling them where they were. Pointing all five
 * at the new path instead would have been worse, marking five items current at
 * once. P1-3 still owns the full restructure and its own acceptance tests; this
 * only keeps the nav honest in the meantime.
 */
const PRIMARY_NAV: Array<{ href: string; label: string }> = [
  { href: '/account', label: 'Overview' },
  { href: '/account/bookings', label: 'Bookings' },
  { href: '/account/events', label: 'Events' },
  { href: '/account/passes', label: 'Passes and plans' },
  { href: '/account/resources', label: 'Resources' },
  { href: '/account/profile', label: 'Profile' },
  { href: '/account/payment-methods', label: 'Payments' },
  { href: '/account/security', label: 'Security' },
];

function linkActive(pathname: string, href: string): boolean {
  if (href === '/account') return pathname === '/account';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AccountNav({ showVenueDashboard }: { showVenueDashboard: boolean }) {
  const pathname = usePathname() ?? '';

  const linkClass = (href: string) => {
    const active = linkActive(pathname, href);
    return [
      'shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors',
      active
        ? 'bg-white text-brand-800 shadow-sm ring-1 ring-slate-200/80'
        : 'text-slate-600 hover:bg-white/60 hover:text-slate-900',
    ].join(' ');
  };

  return (
    <nav
      className="border-b border-slate-200/80 bg-slate-100/80 backdrop-blur-sm"
      aria-label="Account sections"
    >
      <div className="mx-auto max-w-5xl px-4">
        <div className="-mx-1 flex gap-0.5 overflow-x-auto py-2 sm:flex-wrap sm:overflow-visible sm:py-2.5">
          {PRIMARY_NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              // The active item was signalled by colour alone, which a screen
              // reader cannot see and a colour-blind user may not either.
              aria-current={linkActive(pathname, item.href) ? 'page' : undefined}
              className={linkClass(item.href)}
            >
              {item.label}
            </Link>
          ))}
          {showVenueDashboard ? (
            <Link
              href="/dashboard"
              className="shrink-0 whitespace-nowrap rounded-lg border border-dashed border-brand-300/80 bg-brand-50/50 px-3 py-2 text-sm font-semibold text-brand-800 transition-colors hover:bg-brand-50"
            >
              Venue dashboard
            </Link>
          ) : null}
        </div>
      </div>
    </nav>
  );
}
