'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * The four primary items (P1-3, closes G18).
 *
 * It carried twelve, plus a conditional thirteenth, and a customer met three
 * different menus before reaching any content: this nav, a twelve-card grid on
 * the hub, and a second static hub at `/account/classes`. The other eight
 * destinations are not gone, they have a home: events and resources are type
 * filters on Bookings, the four commerce screens are tabs on Passes and plans
 * (P1-5), and payments and security are sections of Profile. Every one of the
 * old paths still resolves, by redirect, and `retired-routes.ts` is the list.
 *
 * Overview is deliberately NOT here. The hub is what the ResNeo wordmark in the
 * header goes to, which is where a customer already expects "take me back to
 * the start" to live, and spending one of four slots on it would have meant
 * dropping a real destination.
 *
 * Help is the only item that leaves the portal. It is in the four because
 * "where do I get help" is a question customers ask from inside their account,
 * and the footer link alone made them scroll the whole page to find it.
 */
const PRIMARY_NAV: Array<{ href: string; label: string }> = [
  { href: '/account/bookings', label: 'Bookings' },
  { href: '/account/passes', label: 'Passes and plans' },
  { href: '/account/profile', label: 'Profile' },
  { href: '/help', label: 'Help' },
];

/**
 * Prefix match, so a customer reading one booking is still under Bookings.
 *
 * This carried an exact-match branch for `/account`, because the hub's href is
 * a prefix of every route in the portal and would otherwise have marked itself
 * current everywhere. Overview stopped being an item in P1-3, which made that
 * branch unreachable, and a mutation sweep confirmed no test could tell it
 * apart from nothing. Removed rather than kept warm: **if Overview is ever
 * added back as `/account`, it needs the exact-match guard again**, and a
 * branch nothing exercises is a worse reminder of that than this sentence.
 */
function linkActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AccountNav({ showVenueDashboard }: { showVenueDashboard: boolean }) {
  const pathname = usePathname() ?? '';

  const linkClass = (href: string) => {
    const active = linkActive(pathname, href);
    return [
      // `px-2.5` below `sm`, measured rather than chosen: at `px-3` the four
      // items overflow a 375px row by 3px, which clips the edge of "Help" with
      // no cue that anything is cut off. Four items is the whole point of
      // P1-3, so they have to fit.
      'shrink-0 whitespace-nowrap rounded-lg px-2.5 py-2 text-sm font-medium transition-colors sm:px-3',
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
