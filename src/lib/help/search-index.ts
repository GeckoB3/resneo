import Fuse from 'fuse.js';
import { buildSearchDocs } from './navigation';
import type { HelpSearchDoc } from './types';

const FUSE_KEYS = [
  { name: 'title' as const, weight: 3 },
  { name: 'description' as const, weight: 2 },
  { name: 'tagsText' as const, weight: 2 },
  { name: 'content' as const, weight: 1 },
];

const FUSE_OPTIONS = {
  keys: FUSE_KEYS,
  threshold: 0.38,
  ignoreLocation: true,
  minMatchCharLength: 2,
};

let fuseInstance: Fuse<HelpSearchDoc> | null = null;

export function createHelpSearchFuse(docs: HelpSearchDoc[]): Fuse<HelpSearchDoc> {
  return new Fuse(docs, FUSE_OPTIONS);
}

export function getHelpSearchFuse(): Fuse<HelpSearchDoc> {
  if (!fuseInstance) {
    fuseInstance = createHelpSearchFuse(buildSearchDocs());
  }
  return fuseInstance;
}

export function searchHelpArticlesWithFuse(
  fuse: Fuse<HelpSearchDoc>,
  query: string,
  limit = 8,
): HelpSearchDoc[] {
  const q = query.trim();
  if (q.length < 2) return [];
  return fuse.search(q, { limit }).map((r) => r.item);
}

export function searchHelpArticles(query: string, limit = 8): HelpSearchDoc[] {
  return searchHelpArticlesWithFuse(getHelpSearchFuse(), query, limit);
}
