import { NextResponse } from 'next/server';

/**
 * `GET /.well-known/apple-app-site-association` (C12, P3-4i).
 *
 * Apple fetches this to decide whether resneo-app may open `www.resneo.com`
 * links itself instead of handing them to Safari. Three constraints it enforces
 * strictly, all of which are why this is a route handler rather than a file in
 * `public/`:
 *
 *   - `application/json`, set explicitly. The file has NO `.json` extension, by
 *     Apple's design, so a static file would be served with a generic content
 *     type, and `next.config.ts` adds `nosniff` to every route, which stops the
 *     browser rescuing it.
 *   - **No redirect.** Apple does not follow a 3xx when verifying. The apex
 *     307s to www, which is why the app declares www and only www.
 *   - Plain JSON, unsigned. Signing is the old format and modern iOS wants
 *     this.
 *
 * `force-static` because it is a constant: it is prerendered at build and
 * served without running this function, which also means it cannot fail at
 * request time.
 *
 * **Ordering matters and this file is the first step.** Universal links were
 * removed from the app on 2026-08-09 because this 404'd, and on Android 12+ a
 * FAILED verification is worse than none: the app stops being offered as a
 * handler at all, so every link opens the browser and the symptom reads as
 * "deep links are broken" rather than as a missing file. The order is: serve
 * these, verify 200 with this content type and no redirect, and only then does
 * the app restore `ios.associatedDomains` and ship a build.
 */
export const dynamic = 'force-static';

/**
 * Verbatim from `Docs/universal-links/apple-app-site-association` in the app
 * repo, which is where it is authored. The Team ID was read from the ad-hoc
 * provisioning profile and cross-checked against its `application-identifier`.
 * Nothing here is secret: a Team ID is published by every app that supports
 * universal links.
 *
 * The paths claimed are the WEB's, not the app's. The app translates them to
 * its own routes in `app/+native-intent.tsx`, so `/account/bookings/{id}` opens
 * as `/booking/{id}` there.
 *
 * **The trailing exclusion is the load-bearing part.** Everything else under
 * `/account/*` stays in the browser deliberately, because the app has no screen
 * for it and opening the app on a not-found is worse than opening the page that
 * exists. A portal route that the app also gains has to be added HERE and in
 * the app's translation together, or one of the two lies.
 */
const APPLE_APP_SITE_ASSOCIATION = {
  applinks: {
    details: [
      {
        appIDs: ['4V8S56N4XX.com.resneo.app'],
        components: [
          {
            '/': '/account/bookings/*',
            comment:
              'One booking. The app rewrites this to its own /booking/{id} in +native-intent.',
          },
          {
            '/': '/account/bookings',
            comment: 'The bookings list.',
          },
          {
            '/': '/account/passes*',
            comment: "Passes and plans, including the web's per-tab links.",
          },
          {
            '/': '/account/profile',
            comment: 'Profile, preferences and payments.',
          },
          {
            '/': '/account',
            comment: 'The customer hub.',
          },
          {
            '/': '/account/*',
            exclude: true,
            comment:
              'Anything else under /account stays in the browser. The app has no screen for it, and opening the app on a not-found is worse than opening the page that exists.',
          },
        ],
      },
    ],
  },
} as const;

export async function GET() {
  return NextResponse.json(APPLE_APP_SITE_ASSOCIATION, {
    // Pinned rather than inherited. `NextResponse.json` already sends JSON, but
    // this is the one header Apple refuses to guess at, and it is cheap to make
    // the guarantee explicit where the test can read it.
    headers: { 'Content-Type': 'application/json' },
  });
}
