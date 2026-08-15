import { describe, expect, it } from 'vitest';
import sitemap from './sitemap';
import { HELP_CATEGORIES } from '@/lib/help/navigation';

/**
 * The help centre was absent from the sitemap entirely, and had no link from
 * any indexable page, so ~66 live articles had no crawl path at all. It is
 * generated from HELP_CATEGORIES now rather than hand-listed, and this pins
 * that: writing an article is enough to get it indexed, and nobody has to
 * remember a second step.
 *
 * Asserted on PATHS, not full URLs: the base comes from NEXT_PUBLIC_BASE_URL and
 * differs between environments, and a prefix test on the whole URL also matches
 * innocent article slugs (`/help/.../payments` contains `/pay`).
 */
describe('sitemap', () => {
  const paths = sitemap().map((e) => new URL(e.url).pathname.replace(/\/$/, '') || '/');

  it('lists the help hub, every category and every article', () => {
    expect(paths).toContain('/help');
    for (const category of HELP_CATEGORIES) {
      expect(paths).toContain(`/help/${category.slug}`);
      for (const article of category.articles) {
        expect(paths).toContain(`/help/${category.slug}/${article.slug}`);
      }
    }
  });

  it('emits one entry per help page and no more', () => {
    const expected = 1 + HELP_CATEGORIES.reduce((n, c) => n + 1 + c.articles.length, 0);
    expect(paths.filter((p) => p === '/help' || p.startsWith('/help/')).length).toBe(expected);
  });

  it('still lists the marketing and legal pages', () => {
    for (const p of ['/', '/solutions', '/calculator', '/privacy', '/terms', '/terms/customer']) {
      expect(paths).toContain(p);
    }
  });

  it('emits no duplicates', () => {
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('never lists a path robots.txt disallows', () => {
    const blocked = ['/dashboard', '/account', '/confirm', '/embed', '/pay', '/manage', '/api'];
    for (const prefix of blocked) {
      const hit = paths.find((p) => p === prefix || p.startsWith(`${prefix}/`));
      expect(hit, `sitemap lists a disallowed path: ${hit}`).toBeUndefined();
    }
  });
});
