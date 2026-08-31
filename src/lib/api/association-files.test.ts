/**
 * C12: the two files that decide whether resneo-app may open our links.
 *
 * These are not ordinary routes. They are read by Apple's and Google's
 * verifiers, which fetch once, do not follow redirects, and do not explain
 * themselves when they refuse. A wrong content type or a stray 3xx does not
 * fail here or in the app's own tests: it fails silently, months later, as
 * "the app does not open links any more", and on Android 12+ it is worse than
 * not trying, because a FAILED verification stops the app being offered as a
 * handler at all. That is what removed universal links from the app on
 * 2026-08-09.
 *
 * So the properties worth pinning are the hosting ones, not the JSON.
 *
 * Not colocated with the routes: they live under `src/app/.well-known/`, and
 * vitest's globs do not descend into a dot-directory, so a test beside them
 * would never run. That is the same silence this file exists to prevent.
 */
import { describe, it, expect } from 'vitest';

import { GET as getAasa } from '@/app/.well-known/apple-app-site-association/route';
import { GET as getAssetLinks } from '@/app/.well-known/assetlinks.json/route';
import { config as middlewareConfig } from '@/middleware';

describe('the association files as the verifiers see them', () => {
  it('the AASA answers 200 as application/json, with no redirect', async () => {
    const res = await getAasa();
    expect(res.status).toBe(200);
    // `application/json`, and not a rescue by content sniffing: the file has no
    // extension by Apple's design, and `next.config.ts` sends `nosniff`.
    expect(res.headers.get('content-type')).toMatch(/^application\/json/);
    expect(res.headers.get('location'), 'a 3xx is not followed by the verifier').toBeNull();
  });

  it('assetlinks.json answers 200 as application/json, with no redirect', async () => {
    const res = await getAssetLinks();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^application\/json/);
    expect(res.headers.get('location')).toBeNull();
  });

  it('middleware does not run on .well-known, so nothing can redirect it later', async () => {
    /*
      The exclusion is the guarantee. Asserted by running the matcher the way
      Next does rather than by eyeballing the pattern, because the thing it
      protects against is a redirect added to middleware years from now by
      somebody who never reads this file.

      ANCHORED, which is not a detail. Next compiles a matcher through
      path-to-regexp, which anchors both ends; an unanchored `new RegExp` finds
      the pattern at a later offset instead and reports that every path
      matches, including the two this test is about. The first version of this
      test did exactly that and failed against a correct exclusion.
    */
    const matcher = new RegExp(`^${middlewareConfig.matcher[0]}$`);
    expect(matcher.test('/.well-known/apple-app-site-association')).toBe(false);
    expect(matcher.test('/.well-known/assetlinks.json')).toBe(false);
    // Vacuity guard: the pattern still matches the routes it is there for.
    expect(matcher.test('/dashboard')).toBe(true);
    expect(matcher.test('/account/bookings')).toBe(true);
  });
});

describe('what the AASA claims', () => {
  it('claims the five portal paths the app can actually open', async () => {
    const body = (await getAasa().then((r) => r.json())) as {
      applinks: { details: Array<{ appIDs: string[]; components: Array<Record<string, unknown>> }> };
    };
    const [detail] = body.applinks.details;

    expect(detail.appIDs).toEqual(['4V8S56N4XX.com.resneo.app']);
    expect(detail.components.filter((c) => !c.exclude).map((c) => c['/'])).toEqual([
      '/account/bookings/*',
      '/account/bookings',
      '/account/passes*',
      '/account/profile',
      '/account',
    ]);
  });

  it('excludes the rest of /account, and does so LAST', async () => {
    /*
      Order is behaviour here, not style. Apple takes the first component that
      matches, so a `/account/*` exclusion sitting above the paths it overlaps
      would swallow all of them and every link would open the browser. The app
      has no screen for the rest of `/account`, and opening the app on a
      not-found is worse than opening the page that exists.
    */
    const body = (await getAasa().then((r) => r.json())) as {
      applinks: { details: Array<{ components: Array<Record<string, unknown>> }> };
    };
    const components = body.applinks.details[0].components;
    const excluded = components.filter((c) => c.exclude === true);

    expect(excluded.map((c) => c['/'])).toEqual(['/account/*']);
    expect(components.indexOf(excluded[0])).toBe(components.length - 1);
  });
});

describe('what assetlinks.json claims', () => {
  it('carries BOTH signing fingerprints, not just the Play one', async () => {
    // The Play app-signing cert covers Store installs; the EAS upload key
    // covers internal-distribution builds. With only the first, every
    // pre-release build fails verification, which is indistinguishable from
    // the file being wrong.
    const body = (await getAssetLinks().then((r) => r.json())) as Array<{
      relation: string[];
      target: { namespace: string; package_name: string; sha256_cert_fingerprints: string[] };
    }>;

    expect(body).toHaveLength(1);
    expect(body[0].relation).toEqual(['delegate_permission/common.handle_all_urls']);
    expect(body[0].target.namespace).toBe('android_app');
    expect(body[0].target.package_name).toBe('com.resneo.app');
    expect(body[0].target.sha256_cert_fingerprints).toHaveLength(2);
    for (const fp of body[0].target.sha256_cert_fingerprints) {
      expect(fp, 'a fingerprint Android will not parse').toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    }
  });
});
