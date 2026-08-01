/**
 * The one canonical top-level link set for the marketing site.
 *
 * These are the same four destinations the homepage bar carries, so the header
 * reads identically wherever a visitor lands (homepage, solutions hub, or any
 * vertical page). Kept in a plain module with no React so both the server nav
 * and the client mobile panel can import it.
 *
 * The homepage sections among them carry a leading "/": a vertical page has no
 * #features of its own, and a bare "#features" there would scroll nowhere.
 */
export type MarketingNavItem = {
  href: string;
  label: string;
  /** Route navigations use next/link; same-document hashes use a plain anchor. */
  route?: boolean;
};

export const MARKETING_NAV_ITEMS: MarketingNavItem[] = [
  { href: "/#features", label: "Features" },
  { href: "/solutions", label: "Solutions", route: true },
  { href: "/#pricing", label: "Pricing" },
  { href: "/help", label: "Help", route: true },
];

/** Where "Start free trial" points. The homepage pricing table is the sign-up entry. */
export const MARKETING_SIGNUP_HREF = "/#pricing";

/** Secondary destinations that only need to appear in the mobile panel. */
export const MARKETING_NAV_SECONDARY: MarketingNavItem[] = [
  { href: "/#link-break", label: "Link & break" },
  { href: "/about", label: "About", route: true },
  { href: "/login", label: "Log in", route: true },
];
