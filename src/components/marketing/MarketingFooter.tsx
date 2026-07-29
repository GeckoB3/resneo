import Link from "next/link";
import { SocialLinks } from "./SocialLinks";
import { MARKETING_SIGNUP_HREF } from "./marketing-nav-items";

/**
 * The shared marketing footer.
 *
 * Replaces seven near-identical single-row footers that had drifted apart (some
 * carried the terms link, some did not; some carried the social icons, some did
 * not). The column layout also gives every vertical page a link to every other
 * one, which the single-row version could not fit.
 *
 * Legal links (Website Terms of Use, Privacy Policy) and the company details are
 * required on every page, so they live in the always-rendered bottom bar.
 */

const SOLUTION_LINKS = [
  { href: "/salon-booking-software", label: "Hair salons & barbers" },
  { href: "/beauty-booking-software", label: "Beauty & aesthetics" },
  { href: "/wellness-booking-software", label: "Health & wellbeing" },
  { href: "/class-booking-software", label: "Studios & classes" },
  { href: "/facility-booking-software", label: "Courts & venues" },
  { href: "/restaurant", label: "Restaurants" },
];

const PRODUCT_LINKS: { href: string; label: string; route?: boolean }[] = [
  { href: "/#features", label: "Features" },
  { href: "/#link-break", label: "Link & break" },
  { href: "/#pricing", label: "Pricing" },
  { href: "/appointments-plan", label: "Appointments plan", route: true },
  { href: "/restaurant", label: "Restaurant plan", route: true },
];

const COMPANY_LINKS: { href: string; label: string; route?: boolean }[] = [
  { href: "/about", label: "About ResNeo", route: true },
  { href: "/#contact", label: "Talk to us" },
  { href: MARKETING_SIGNUP_HREF, label: "Sign up" },
  { href: "/login", label: "Log in", route: true },
];

const linkClass =
  "inline-flex min-h-11 items-center text-sm text-slate-600 transition-colors hover:text-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600";

function FooterColumn({
  title,
  links,
}: {
  title: string;
  links: { href: string; label: string; route?: boolean }[];
}) {
  return (
    <div>
      <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-900">{title}</h2>
      <ul className="mt-3 space-y-0.5">
        {links.map((l) => (
          <li key={`${title}-${l.href}`}>
            {l.route ? (
              <Link href={l.href} className={linkClass}>
                {l.label}
              </Link>
            ) : (
              <a href={l.href} className={linkClass}>
                {l.label}
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function MarketingFooter() {
  return (
    <footer className="border-t border-slate-200 bg-slate-50">
      <div className="mx-auto max-w-6xl px-6 py-14">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <Link
              href="/"
              className="inline-flex min-h-11 items-center rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            >
              <img src="/Logo.png" alt="ResNeo" className="h-8 w-auto" />
            </Link>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-slate-600">
              One booking platform for appointments, classes, resources and tables. No booking
              commission, and your clients stay yours.
            </p>
            <SocialLinks className="mt-6" />
          </div>

          <FooterColumn title="Product" links={PRODUCT_LINKS} />
          <FooterColumn
            title="Solutions"
            links={[
              { href: "/solutions", label: "All solutions", route: true },
              ...SOLUTION_LINKS.map((l) => ({ ...l, route: true })),
            ]}
          />
          <FooterColumn title="Company" links={COMPANY_LINKS} />
        </div>

        <div className="mt-12 flex flex-col gap-4 border-t border-slate-200 pt-6 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-xl leading-snug">
            &copy; 2026 ResNeo · JAR 26 LTD (NI740269) · 100a Main Street, Bangor, BT20 4AG, UK
          </p>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
            <Link
              href="/terms"
              className="inline-flex min-h-11 items-center transition-colors hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            >
              Website Terms of Use
            </Link>
            <Link
              href="/privacy"
              className="inline-flex min-h-11 items-center transition-colors hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            >
              Privacy Policy
            </Link>
            <a
              href="mailto:hello@resneo.com"
              className="inline-flex min-h-11 items-center transition-colors hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            >
              hello@resneo.com
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
