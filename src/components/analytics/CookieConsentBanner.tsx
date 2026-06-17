'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/primitives/Button';
import {
  isAnalyticsSuppressedPath,
  setConsent,
  useCookieConsent,
} from '@/lib/analytics/cookie-consent';

/**
 * Bottom-anchored cookie-consent banner. Shows until the visitor accepts or
 * declines analytics cookies; the choice gates Google Analytics (see AnalyticsGate).
 *
 * While consent is "unknown" on the server and first client paint the banner
 * renders nothing, avoiding a hydration mismatch; once mounted it appears only if
 * no choice has been made. Hidden on routes where analytics is suppressed.
 */
export function CookieConsentBanner() {
  const consent = useCookieConsent();
  const pathname = usePathname();

  if (consent !== 'unknown' || isAnalyticsSuppressedPath(pathname)) {
    return null;
  }

  return (
    <div
      role="region"
      aria-label="Cookie consent"
      className="fixed inset-x-0 bottom-0 z-50 px-4 pb-4"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-lg sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-slate-600">
          We use cookies to measure site traffic and understand where our visitors
          come from.{' '}
          <Link
            href="/privacy"
            className="font-medium text-brand-600 underline-offset-2 hover:underline"
          >
            Learn more
          </Link>
          .
        </p>
        <div className="flex shrink-0 gap-2">
          <Button variant="secondary" size="sm" onClick={() => setConsent('denied')}>
            Decline
          </Button>
          <Button variant="primary" size="sm" onClick={() => setConsent('granted')}>
            Accept
          </Button>
        </div>
      </div>
    </div>
  );
}
