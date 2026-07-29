import Link from "next/link";
import { MarketingMobileNav } from "./MarketingMobileNav";
import {
  MARKETING_NAV_ITEMS,
  MARKETING_SIGNUP_HREF,
  type MarketingNavItem,
} from "./marketing-nav-items";

/**
 * The shared marketing header.
 *
 * Every marketing page outside the homepage used to hand-roll its own bar with
 * two or three ad-hoc links, so the site read as several different products and
 * had no navigation at all below the sm breakpoint. This is the single header
 * for all of them, carrying the same four destinations as the homepage bar.
 */
export function MarketingNav({
  currentHref,
  sectionHref,
  extraLink,
  ctaHref = MARKETING_SIGNUP_HREF,
  ctaLabel = "Start free trial",
  ctaShortLabel = "Start free",
}: {
  /**
   * Href of the page you are actually on. Emits aria-current="page", so it must
   * equal location.pathname: a child page passing its parent here would announce
   * the wrong URL as current.
   */
  currentHref?: string;
  /**
   * Href of a section this page sits *under* but is not (for example the guide
   * at /solutions/... whose parent is /solutions). Emits aria-current="true",
   * the correct token for an ancestor, which reads as "current" without
   * claiming to be the current page.
   */
  sectionHref?: string;
  /**
   * One page-specific link (usually an in-page anchor) surfaced next to the
   * shared set. Shown from lg up on desktop so the four shared links always fit
   * at 768px, and always present in the mobile panel.
   */
  extraLink?: MarketingNavItem;
  /**
   * Where the primary button goes. Defaults to the homepage pricing table, which
   * is the site-wide sign-up convention. A page selling one specific plan should
   * override it rather than dump the visitor on a table of other plans.
   */
  ctaHref?: string;
  ctaLabel?: string;
  /**
   * Wording below lg. Override it whenever you override ctaLabel: the default
   * pair is "Start free trial" and "Start free", and a longer custom label will
   * not fit at 375px or leave the four links room at 768px.
   */
  ctaShortLabel?: string;
}) {
  // "page" only for the exact URL; "true" for an ancestor section.
  const ariaCurrentFor = (href: string): "page" | "true" | undefined =>
    href === currentHref ? "page" : href === sectionHref ? "true" : undefined;

  // min-h-11 because md starts at 768px, which is a touch tablet, not a mouse.
  // Deliberately carries no display utility: the extra link needs `hidden
  // lg:inline-flex`, and an unprefixed `inline-flex` here would out-cascade the
  // unprefixed `hidden` and leak that link onto every width.
  const linkClass =
    "min-h-11 items-center whitespace-nowrap text-sm font-medium text-slate-600 transition-colors hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-600 aria-[current=page]:font-semibold aria-[current=page]:text-brand-700 aria-[current=true]:font-semibold aria-[current=true]:text-brand-700";

  return (
    <nav
      aria-label="Primary"
      className="sticky top-0 z-50 border-b border-slate-200/70 bg-white/80 backdrop-blur-xl"
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3.5">
        <Link
          href="/"
          className="flex min-h-11 flex-shrink-0 items-center rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          <img src="/Logo.png" alt="ResNeo" className="h-8 w-auto" />
        </Link>

        {/* Four links so the bar still fits at 768px. Everything else stays
            reachable from the mobile panel and the footer. */}
        <div className="hidden items-center gap-6 md:flex lg:gap-8">
          {MARKETING_NAV_ITEMS.map((item) =>
            item.route ? (
              <Link
                key={item.href}
                href={item.href}
                className={`inline-flex ${linkClass}`}
                aria-current={ariaCurrentFor(item.href)}
              >
                {item.label}
              </Link>
            ) : (
              <a
                key={item.href}
                href={item.href}
                className={`inline-flex ${linkClass}`}
                aria-current={ariaCurrentFor(item.href)}
              >
                {item.label}
              </a>
            ),
          )}
          {extraLink ? (
            <a href={extraLink.href} className={`hidden lg:inline-flex ${linkClass}`}>
              {extraLink.label}
            </a>
          ) : null}
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <Link
            href="/login"
            className="hidden min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-slate-700 transition-colors hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 sm:inline-flex"
          >
            Log in
          </Link>
          <a
            href={ctaHref}
            className="inline-flex min-h-11 items-center rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white shadow-sm transition-all hover:bg-brand-700 hover:shadow-md hover:shadow-brand-600/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
          >
            {/* Short label below lg. It keeps the bar on one line at 320px, and
                at md it buys back the headroom the four links need when a page
                overrides ctaLabel with something long. */}
            <span className="lg:hidden">{ctaShortLabel}</span>
            <span className="hidden lg:inline">{ctaLabel}</span>
          </a>
          <MarketingMobileNav
            currentHref={currentHref}
            sectionHref={sectionHref}
            extraLink={extraLink}
          />
        </div>
      </div>
    </nav>
  );
}
