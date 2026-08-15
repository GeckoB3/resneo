import type { MetadataRoute } from "next";
import { normalizePublicBaseUrl } from "@/lib/public-base-url";
import { HELP_CATEGORIES } from "@/lib/help/navigation";

/**
 * Public marketing + legal routes for search engines, served at /sitemap.xml.
 *
 * Private and non-indexable areas are intentionally excluded: dashboard, account, onboarding,
 * signup/login, super/sales admin, API routes, payment/pay flows, embeds, and demo/sample venue
 * pages. Add new public marketing pages here when they ship.
 */
type ChangeFrequency = MetadataRoute.Sitemap[number]["changeFrequency"];

const ROUTES: { path: string; changeFrequency: ChangeFrequency; priority: number }[] = [
  { path: "/", changeFrequency: "weekly", priority: 1 },
  { path: "/solutions", changeFrequency: "monthly", priority: 0.9 },
  {
    path: "/solutions/salon-chair-rental-hmrc-employment-status",
    changeFrequency: "monthly",
    priority: 0.7,
  },
  {
    path: "/solutions/fitness-studio-booking-software-true-cost",
    changeFrequency: "monthly",
    priority: 0.7,
  },
  { path: "/salon-booking-software", changeFrequency: "monthly", priority: 0.8 },
  { path: "/beauty-booking-software", changeFrequency: "monthly", priority: 0.8 },
  { path: "/wellness-booking-software", changeFrequency: "monthly", priority: 0.8 },
  { path: "/class-booking-software", changeFrequency: "monthly", priority: 0.8 },
  { path: "/facility-booking-software", changeFrequency: "monthly", priority: 0.8 },
  { path: "/restaurant", changeFrequency: "monthly", priority: 0.8 },
  { path: "/appointments-plan", changeFrequency: "monthly", priority: 0.7 },
  { path: "/calculator", changeFrequency: "monthly", priority: 0.7 },
  { path: "/about", changeFrequency: "monthly", priority: 0.5 },
  { path: "/privacy", changeFrequency: "yearly", priority: 0.3 },
  { path: "/terms", changeFrequency: "yearly", priority: 0.3 },
  { path: "/terms/customer", changeFrequency: "yearly", priority: 0.3 },
  { path: "/terms/data-processing", changeFrequency: "yearly", priority: 0.3 },
  { path: "/help", changeFrequency: "weekly", priority: 0.6 },
];

/**
 * The help centre, generated from the same catalogue the pages render from.
 *
 * It was absent entirely: ~66 articles that are live, crawlable and carry the
 * long-tail queries this product should rank for, with no sitemap entry AND no
 * link from any indexable page (the marketing footer links only /, /privacy and
 * /terms; every other link to /help sits inside /help itself or under
 * robots-disallowed /account and /dashboard). Listing them here is half the fix;
 * the footer link added alongside is the other half, because a sitemap tells a
 * crawler a URL exists while an internal link is what gives it standing.
 *
 * Generated rather than hand-listed so a new article is indexed by writing the
 * article, which is the only version of this that survives contact with people
 * adding content.
 */
function helpRoutes(): { path: string; changeFrequency: ChangeFrequency; priority: number }[] {
  return HELP_CATEGORIES.flatMap((category) => [
    { path: `/help/${category.slug}`, changeFrequency: "monthly" as const, priority: 0.5 },
    ...category.articles.map((article) => ({
      path: `/help/${category.slug}/${article.slug}`,
      changeFrequency: "monthly" as const,
      priority: 0.4,
    })),
  ]);
}

export default function sitemap(): MetadataRoute.Sitemap {
  const base = normalizePublicBaseUrl(process.env.NEXT_PUBLIC_BASE_URL);
  const lastModified = new Date();

  return [...ROUTES, ...helpRoutes()].map((r) => ({
    url: `${base}${r.path}`,
    lastModified,
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));
}
