'use client';

import { GoogleAnalytics } from '@next/third-parties/google';
import { usePathname } from 'next/navigation';
import {
  isAnalyticsSuppressedPath,
  useCookieConsent,
} from '@/lib/analytics/cookie-consent';

// Inlined at build time for the client bundle; undefined where unset (dev/preview).
const GA_ID = process.env.NEXT_PUBLIC_GA_ID;

/**
 * Loads Google Analytics 4 only after the visitor grants cookie consent.
 * Renders nothing — so no GA script and no cookies — when GA is unconfigured,
 * consent is absent/denied, or we're on a suppressed route (e.g. /embed/*).
 */
export function AnalyticsGate() {
  const consent = useCookieConsent();
  const pathname = usePathname();

  if (!GA_ID || consent !== 'granted' || isAnalyticsSuppressedPath(pathname)) {
    return null;
  }

  return <GoogleAnalytics gaId={GA_ID} />;
}
