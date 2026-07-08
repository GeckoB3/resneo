'use client';

/**
 * Client-side cookie-consent store for analytics gating.
 *
 * The visitor's choice is persisted in a first-party cookie and read through
 * useSyncExternalStore so subscribers stay in sync without setState-in-effect
 * lint errors or hydration mismatches (the server/first-paint snapshot is always
 * "unknown"). See the client-cookie-read pattern for why this beats reading in an
 * effect. Consent gates Google Analytics — nothing loads until it is "granted".
 *
 * Why a cookie and not localStorage: signing out hard-navigates through
 * /auth/signed-out, whose response sends `Clear-Site-Data: "cache", "storage"`.
 * That flush wipes localStorage but NOT cookies, so a localStorage-backed choice
 * was erased on every logout and the banner returned on the visitor's next
 * visit. A first-party cookie survives the teardown, and a cookie recording
 * consent is itself "strictly necessary", so persisting it without consent is
 * permitted.
 */

import { useSyncExternalStore } from 'react';

export type ConsentChoice = 'granted' | 'denied';
/**
 * 'pending' = the cookie has not been read yet (server render and the
 * hydration pass); 'unknown' = the cookie was read and no choice exists.
 * The banner renders ONLY on 'unknown': rendering it while 'pending' would
 * put it in the server HTML for every visitor, flashing it at returning
 * visitors until hydration reads their stored choice.
 */
export type ConsentState = ConsentChoice | 'unknown' | 'pending';

const COOKIE_NAME = 'resneo_cookie_consent';
const CHANGE_EVENT = 'resneo:cookie-consent-change';
// Remember the choice for a year — the usual consent lifetime before re-asking.
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

function readCookie(name: string): string | null {
  const prefix = `${name}=`;
  for (const part of document.cookie.split('; ')) {
    if (part.startsWith(prefix)) return part.slice(prefix.length);
  }
  return null;
}

function readSnapshot(): ConsentState {
  if (typeof document === 'undefined') return 'unknown';
  const value = readCookie(COOKIE_NAME);
  return value === 'granted' || value === 'denied' ? value : 'unknown';
}

function readServerSnapshot(): ConsentState {
  return 'pending';
}

function subscribe(onChange: () => void): () => void {
  // CHANGE_EVENT handles same-tab updates; cookies have no native change event.
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => window.removeEventListener(CHANGE_EVENT, onChange);
}

/** Record the visitor's choice and notify subscribers in this tab. */
export function setConsent(choice: ConsentChoice): void {
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${COOKIE_NAME}=${choice}; Max-Age=${MAX_AGE_SECONDS}; Path=/; SameSite=Lax${secure}`;
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Reactive read of the current consent state. */
export function useCookieConsent(): ConsentState {
  return useSyncExternalStore(subscribe, readSnapshot, readServerSnapshot);
}

/**
 * Routes where we must never load analytics or show the consent banner.
 * `/embed/*` renders inside the customer's own website (iframe) — their site
 * owns cookie consent there, not us.
 */
export function isAnalyticsSuppressedPath(pathname: string | null): boolean {
  return !!pathname && pathname.startsWith('/embed');
}
