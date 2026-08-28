import path from "node:path";
import type { NextConfig } from "next";
import { RETIRED_ACCOUNT_ROUTES } from "./src/app/account/retired-routes";

const nextConfig: NextConfig = {
  // Allow a second concurrent `next dev` (e.g. a parallel Claude session) to use its
  // own build dir + dev lock. Defaults to `.next` so normal runs are unaffected.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  // Pin workspace root so Turbopack resolves `next` from repo root (not `src/app`).
  turbopack: {
    root: path.join(__dirname),
  },
  reactCompiler: true,
  env: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  },
  /**
   * Routes retired by the customer portal rebuild (P1-5, P1-3).
   *
   * Here rather than as a `redirect()` in each page: a config redirect answers
   * with a real 307 before middleware and before any rendering, where a page
   * level redirect inside the streaming account layout only reaches the
   * customer as a client-side hop after hydration. It also carries the incoming
   * query through, which the class booking flow's deep links depend on. The
   * table and the reasoning live in `src/app/account/retired-routes.ts`.
   *
   * `permanent: false` (307) deliberately. See the note beside the table.
   */
  async redirects() {
    return RETIRED_ACCOUNT_ROUTES.map(({ from, to }) => ({
      source: from,
      destination: to,
      permanent: false,
    }));
  },
  async headers() {
    const sharedSecurity: { key: string; value: string }[] = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    ];
    if (process.env.VERCEL_ENV === 'production') {
      sharedSecurity.push({
        key: 'Strict-Transport-Security',
        value: 'max-age=63072000; includeSubDomains; preload',
      });
    }
    return [
      {
        // Booking widget iframe — must not inherit X-Frame-Options: DENY from the catch-all below.
        source: '/embed/:path*',
        headers: [
          ...sharedSecurity,
          { key: 'Content-Security-Policy', value: 'frame-ancestors *' },
        ],
      },
      {
        // Public booking page — allow same-origin framing (settings live preview iframe fallback).
        source: '/book/:path*',
        headers: [
          ...sharedSecurity,
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
        ],
      },
      {
        // All routes except /embed/* and /book/* (negative lookahead). Next.js cannot unset a header once set by a broader rule.
        source: '/((?!embed/|book/).*)',
        headers: [
          ...sharedSecurity,
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
        ],
      },
    ];
  },
};

export default nextConfig;
