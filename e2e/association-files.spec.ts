import { test, expect } from '@playwright/test';

/**
 * C12: the two files that decide whether resneo-app may open our links.
 *
 * `src/lib/api/association-files.test.ts` pins what the handlers return. This
 * pins what a VERIFIER actually gets, which is a different question and the one
 * that has bitten before: whether the route exists at that path at all (it is
 * served out of a dot-directory, `src/app/.well-known/`), whether anything on
 * the way turns it into a redirect, and whether middleware touches it.
 *
 * Apple and Google fetch these once, follow no redirects, and say nothing when
 * they refuse. On Android 12+ a FAILED verification is worse than none: the app
 * stops being offered as a handler at all, so every link opens Chrome and the
 * symptom reads as "deep links are broken". That is what removed universal
 * links from the app on 2026-08-09.
 */
const ASSOCIATION_FILES = [
  '/.well-known/apple-app-site-association',
  '/.well-known/assetlinks.json',
];

test.describe('association files, as Apple and Android fetch them', () => {
  for (const path of ASSOCIATION_FILES) {
    test(`${path} answers 200 as JSON, with no redirect`, async ({ request }) => {
      // `maxRedirects: 0`, because a verifier does not follow a 3xx. Left at
      // the default, a redirect would be resolved silently and this would pass
      // against the exact configuration that breaks universal links.
      const res = await request.get(path, { maxRedirects: 0 });
      const headers = res.headers();

      expect(res.status(), `${path} must be served directly`).toBe(200);
      expect(
        headers['content-type'],
        'Apple will not infer this: the AASA has no extension and nosniff is set',
      ).toMatch(/^application\/json/);
      expect(headers['location'], 'a verifier will not follow this').toBeUndefined();
      // Parses, rather than merely claiming to be JSON.
      await res.json();
    });
  }

  test('middleware does not run on them, so no session work and nothing to redirect', async ({
    request,
  }) => {
    const res = await request.get(ASSOCIATION_FILES[0], { maxRedirects: 0 });
    expect(
      res.headers()['set-cookie'],
      'middleware ran and touched the session on an anonymous crawler fetch',
    ).toBeUndefined();
  });
});
