import type { MetadataRoute } from "next";
import { normalizePublicBaseUrl } from "@/lib/public-base-url";

/**
 * Served at /robots.txt. Allows crawling of the public marketing pages, points crawlers at the
 * sitemap, and keeps app, account, auth, API, admin, and transactional/per-link routes out of
 * search results.
 *
 * Note: robots.txt is an advisory standard for compliant crawlers, not an access control. Private
 * data is protected by authentication, not by these rules.
 *
 * `/p/` and `/b/` keep their trailing slash on purpose: a bare `/b` prefix would also match
 * `/beauty-booking-software`, and `/p` would match `/privacy`.
 */
const DISALLOW = [
  "/api/",
  "/dashboard",
  "/account",
  "/auth",
  "/super",
  "/sales",
  "/onboarding",
  "/login",
  "/signup",
  "/pay",
  "/manage",
  "/p/",
  "/b/",
  "/ember-steakhouse",
  "/embed-test-page",
  "/email-templates",
];

export default function robots(): MetadataRoute.Robots {
  const base = normalizePublicBaseUrl(process.env.NEXT_PUBLIC_BASE_URL);
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: DISALLOW,
    },
    sitemap: `${base}/sitemap.xml`,
  };
}
