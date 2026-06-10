'use client';

import { useEffect } from 'react';

/**
 * Reload when the page is restored from the back/forward cache.
 *
 * bfcache revives the full JS heap and rendered DOM from before the user
 * navigated away — including everything that was on screen before a logout.
 * After an account switch on the same browser, pressing Back (or a tab
 * restore) could therefore show the previous account's dashboard exactly as
 * it last looked, until the next data poll replaced it. A `pageshow` with
 * `persisted` set is precisely that restore path, so force a fresh load —
 * the server then renders whatever the *current* cookies are entitled to see.
 */
export function BfcacheReloadGuard() {
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        window.location.reload();
      }
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  return null;
}
