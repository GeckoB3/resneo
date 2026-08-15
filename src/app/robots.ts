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
 * `/p/`, `/b/` and `/embed/` keep their trailing slash on purpose: a bare `/b` prefix would also
 * match `/beauty-booking-software`, `/p` would match `/privacy`, and a bare `/embed` would match
 * `/embed-test-page` (harmless here, but the slash keeps the intent explicit). `/confirm` needs no
 * slash: nothing else starts with it.
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
  // Per-booking transactional pages. The comment above already claims these are
  // kept out of search; /confirm was simply missing from the list, so URLs
  // carrying a booking id (and, on the token route, a confirm token) were
  // crawlable. Neither route sets `noindex`, so this list was the only control.
  "/confirm",
  // The embed renders the same booking page as /book/<slug>. Indexing it would
  // compete with the real page for the same content. /embed-test-page was
  // already disallowed, which makes the omission of /embed/ look like an
  // oversight rather than a decision.
  "/embed/",
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
