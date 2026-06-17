'use client';

/**
 * Client-side cookie-consent store for analytics gating.
 *
 * The visitor's choice is persisted in localStorage and read through
 * useSyncExternalStore so subscribers stay in sync without setState-in-effect
 * lint errors or hydration mismatches (the server/first-paint snapshot is always
 * "unknown"). See the client-cookie-read pattern for why this beats reading in an
 * effect. Consent gates Google Analytics — nothing loads until it is "granted".
 */

import { useSyncExternalStore } from 'react';

export type ConsentChoice = 'granted' | 'denied';
export type ConsentState = ConsentChoice | 'unknown';

const STORAGE_KEY = 'resneo_cookie_consent';
const CHANGE_EVENT = 'resneo:cookie-consent-change';

function readSnapshot(): ConsentState {
  if (typeof window === 'undefined') return 'unknown';
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === 'granted' || value === 'denied' ? value : 'unknown';
  } catch {
    // localStorage can throw in private mode / when storage is disabled.
    return 'unknown';
  }
}

function readServerSnapshot(): ConsentState {
  return 'unknown';
}

function subscribe(onChange: () => void): () => void {
  // CHANGE_EVENT handles same-tab updates (the `storage` event only fires in other tabs).
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

/** Record the visitor's choice and notify subscribers in this tab. */
export function setConsent(choice: ConsentChoice): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // Ignore — if we can't persist, the banner simply reappears next load.
  }
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
