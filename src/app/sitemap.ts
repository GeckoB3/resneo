import type { MetadataRoute } from "next";
import { normalizePublicBaseUrl } from "@/lib/public-base-url";

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
  { path: "/salon-booking-software", changeFrequency: "monthly", priority: 0.8 },
  { path: "/beauty-booking-software", changeFrequency: "monthly", priority: 0.8 },
  { path: "/wellness-booking-software", changeFrequency: "monthly", priority: 0.8 },
  { path: "/class-booking-software", changeFrequency: "monthly", priority: 0.8 },
  { path: "/facility-booking-software", changeFrequency: "monthly", priority: 0.8 },
  { path: "/restaurant", changeFrequency: "monthly", priority: 0.8 },
  { path: "/appointments-plan", changeFrequency: "monthly", priority: 0.7 },
  { path: "/about", changeFrequency: "monthly", priority: 0.5 },
  { path: "/privacy", changeFrequency: "yearly", priority: 0.3 },
  { path: "/terms", changeFrequency: "yearly", priority: 0.3 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const base = normalizePublicBaseUrl(process.env.NEXT_PUBLIC_BASE_URL);
  const lastModified = new Date();

  return ROUTES.map((r) => ({
    url: `${base}${r.path}`,
    lastModified,
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));
}
