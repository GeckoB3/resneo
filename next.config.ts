import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
